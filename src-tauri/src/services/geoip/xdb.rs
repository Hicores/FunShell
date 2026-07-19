use std::{
    cmp::Ordering,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    net::IpAddr,
    path::{Path, PathBuf},
};

const HEADER_LENGTH: usize = 256;
const VECTOR_INDEX_LENGTH: usize = 256 * 256 * 8;
const XDB_VERSION: u16 = 3;
const VECTOR_INDEX_POLICY: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpVersion {
    V4,
    V6,
}

impl IpVersion {
    fn header_value(self) -> u16 {
        match self {
            Self::V4 => 4,
            Self::V6 => 6,
        }
    }

    fn address_length(self) -> usize {
        match self {
            Self::V4 => 4,
            Self::V6 => 16,
        }
    }

    fn segment_length(self) -> usize {
        self.address_length() * 2 + 6
    }
}

pub struct XdbSearcher {
    path: PathBuf,
    version: IpVersion,
    file_length: u64,
    vector_index: Vec<u8>,
}

impl XdbSearcher {
    pub fn open(path: &Path, expected_version: IpVersion) -> io::Result<Self> {
        let mut file = File::open(path)?;
        let file_length = file.metadata()?.len();
        let mut header = [0_u8; HEADER_LENGTH];
        file.read_exact(&mut header)?;

        let version = u16::from_le_bytes([header[0], header[1]]);
        let index_policy = u16::from_le_bytes([header[2], header[3]]);
        let ip_version = u16::from_le_bytes([header[16], header[17]]);
        if version != XDB_VERSION
            || index_policy != VECTOR_INDEX_POLICY
            || ip_version != expected_version.header_value()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "不支持的 XDB 数据库格式",
            ));
        }

        let mut vector_index = vec![0_u8; VECTOR_INDEX_LENGTH];
        file.read_exact(&mut vector_index)?;
        Ok(Self {
            path: path.to_path_buf(),
            version: expected_version,
            file_length,
            vector_index,
        })
    }

    pub fn search(&self, ip: IpAddr) -> io::Result<Option<String>> {
        if !matches!(
            (self.version, ip),
            (IpVersion::V4, IpAddr::V4(_)) | (IpVersion::V6, IpAddr::V6(_))
        ) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "IP 版本与 XDB 数据库不匹配",
            ));
        }

        let octets = match ip {
            IpAddr::V4(value) => value.octets().to_vec(),
            IpAddr::V6(value) => value.octets().to_vec(),
        };
        let vector_offset = (usize::from(octets[0]) * 256 + usize::from(octets[1])) * 8;
        let start_ptr = u32::from_le_bytes(
            self.vector_index[vector_offset..vector_offset + 4]
                .try_into()
                .expect("fixed XDB vector pointer"),
        ) as usize;
        let end_ptr = u32::from_le_bytes(
            self.vector_index[vector_offset + 4..vector_offset + 8]
                .try_into()
                .expect("fixed XDB vector pointer"),
        ) as usize;
        if start_ptr == 0 || end_ptr == 0 {
            return Ok(None);
        }

        let segment_length = self.version.segment_length();
        if end_ptr < start_ptr
            || end_ptr
                .checked_add(segment_length)
                .is_none_or(|end| end as u64 > self.file_length)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "XDB 索引指针超出数据库范围",
            ));
        }

        let mut file = File::open(&self.path)?;
        let mut segment = vec![0_u8; segment_length];
        let mut left = 0_usize;
        let mut right = (end_ptr - start_ptr) / segment_length;
        while left <= right {
            let middle = (left + right) / 2;
            let offset = start_ptr + middle * segment_length;
            file.seek(SeekFrom::Start(offset as u64))?;
            file.read_exact(&mut segment)?;

            match self.compare(ip, &segment)? {
                Ordering::Less => {
                    let Some(next) = middle.checked_sub(1) else {
                        break;
                    };
                    right = next;
                }
                Ordering::Greater => left = middle + 1,
                Ordering::Equal => {
                    let address_end = self.version.address_length() * 2;
                    let data_length =
                        u16::from_le_bytes([segment[address_end], segment[address_end + 1]])
                            as usize;
                    let data_offset = u32::from_le_bytes(
                        segment[address_end + 2..address_end + 6]
                            .try_into()
                            .expect("fixed XDB data pointer"),
                    ) as usize;
                    if data_offset
                        .checked_add(data_length)
                        .is_none_or(|end| end as u64 > self.file_length)
                    {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "XDB 数据指针超出数据库范围",
                        ));
                    }
                    let mut value = vec![0_u8; data_length];
                    file.seek(SeekFrom::Start(data_offset as u64))?;
                    file.read_exact(&mut value)?;
                    return String::from_utf8(value)
                        .map(Some)
                        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
                }
            }
        }
        Ok(None)
    }

    fn compare(&self, ip: IpAddr, segment: &[u8]) -> io::Result<Ordering> {
        match ip {
            IpAddr::V4(value) => {
                let ip = u32::from(value);
                let start = u32::from_le_bytes(segment[0..4].try_into().expect("IPv4 start"));
                let end = u32::from_le_bytes(segment[4..8].try_into().expect("IPv4 end"));
                Ok(if ip < start {
                    Ordering::Less
                } else if ip > end {
                    Ordering::Greater
                } else {
                    Ordering::Equal
                })
            }
            IpAddr::V6(value) => {
                let ip = u128::from(value);
                let start = u128::from_be_bytes(segment[0..16].try_into().expect("IPv6 start"));
                let end = u128::from_be_bytes(segment[16..32].try_into().expect("IPv6 end"));
                Ok(if ip < start {
                    Ordering::Less
                } else if ip > end {
                    Ordering::Greater
                } else {
                    Ordering::Equal
                })
            }
        }
    }
}
