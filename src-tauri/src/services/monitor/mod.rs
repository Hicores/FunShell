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

pub const SOCKET_SCRIPT: &str = r#"LC_ALL=C
echo __SOCKETS__
ss -H -tunap 2>/dev/null
echo __TCPINFO__
ss -H -tinp 2>/dev/null
"#;
