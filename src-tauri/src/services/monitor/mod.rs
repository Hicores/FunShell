mod parser;

pub use parser::{
    parse_process_details, parse_processes, parse_snapshot, parse_sockets, parse_system_info,
};

pub const SNAPSHOT_SCRIPT: &str = r#"LC_ALL=C
echo __UPTIME__; cat /proc/uptime 2>/dev/null
echo __LOAD__; cat /proc/loadavg 2>/dev/null
echo __CPU_A__; head -n 1 /proc/stat 2>/dev/null
echo __NET_A__; cat /proc/net/dev 2>/dev/null
sleep 0.2
echo __CPU_B__; head -n 1 /proc/stat 2>/dev/null
echo __NET_B__; cat /proc/net/dev 2>/dev/null
echo __MEM__; cat /proc/meminfo 2>/dev/null
echo __DF__; df -P -B1 2>/dev/null || df -P -k 2>/dev/null
echo __PROC__; ps -eo pid=,user=,rss=,pcpu=,comm=,args= --sort=-pcpu 2>/dev/null | head -n 21 || ps 2>/dev/null
"#;

pub const SYSTEM_SCRIPT: &str = r#"LC_ALL=C
echo __SYSTEM__
printf 'os='; (awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/,"",$2);print $2}' /etc/os-release 2>/dev/null || uname -s)
printf 'kernel='; uname -s 2>/dev/null
printf 'kernel_version='; uname -r 2>/dev/null
printf 'architecture='; uname -m 2>/dev/null
printf 'hostname='; hostname 2>/dev/null
printf 'cpu_model='; (awk -F: '/model name|Hardware/{gsub(/^ +/,"",$2);print $2;exit}' /proc/cpuinfo 2>/dev/null)
printf 'cpu_cores='; (grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 0)
printf 'cpu_mhz='; (awk -F: '/cpu MHz/{gsub(/^ +/,"",$2);print $2;exit}' /proc/cpuinfo 2>/dev/null)
printf 'cache='; (awk -F: '/cache size/{gsub(/^ +/,"",$2);print $2;exit}' /proc/cpuinfo 2>/dev/null)
"#;

pub const PROCESS_SCRIPT: &str = r#"LC_ALL=C
ps -eo pid=,user=,rss=,pcpu=,comm=,args= --sort=-pcpu 2>/dev/null || ps 2>/dev/null
"#;

pub const SOCKET_LISTENER_SCRIPT: &str = r#"LC_ALL=C
echo __ADDRESSES__
ip -o addr show 2>/dev/null
echo __SOCKETS__
ss -H -lnutp 2>/dev/null
echo __TCPINFO__
"#;

pub fn socket_connection_script(
    protocol: &str,
    address_family: &str,
    local_port: u16,
) -> Option<String> {
    let protocol_flag = match protocol.to_ascii_lowercase().as_str() {
        "tcp" => "t",
        "udp" => "u",
        _ => return None,
    };
    let family_flag = match address_family {
        "IPv4" => "4",
        "IPv6" => "6",
        _ => return None,
    };
    let filter = format!("'( sport = :{local_port} )'");
    let tcp_info = if protocol_flag == "t" {
        format!("ss -H -{family_flag}tinp state connected {filter} 2>/dev/null")
    } else {
        String::new()
    };
    Some(format!(
        "LC_ALL=C\necho __ADDRESSES__\nip -o addr show 2>/dev/null\necho __SOCKETS__\nss -H -{family_flag}{protocol_flag}nap state connected {filter} 2>/dev/null\necho __TCPINFO__\n{tcp_info}\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::socket_connection_script;

    #[test]
    fn filters_socket_details_on_the_remote_host() {
        let script = socket_connection_script("tcp", "IPv4", 22).expect("script");
        assert!(script.contains("ss -H -4tnap state connected '( sport = :22 )'"));
        assert!(script.contains("ss -H -4tinp state connected '( sport = :22 )'"));
        assert!(!script.contains("ss -H -tunap"));

        let udp = socket_connection_script("udp", "IPv6", 53).expect("UDP script");
        assert!(udp.contains("ss -H -6unap state connected '( sport = :53 )'"));
        assert!(!udp.contains("ss -H -6uinp"));
        assert!(socket_connection_script("raw", "IPv4", 1).is_none());
        assert!(socket_connection_script("tcp", "未知", 1).is_none());
    }
}
