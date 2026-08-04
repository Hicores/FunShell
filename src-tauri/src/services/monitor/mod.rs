mod parser;

pub use parser::{
    parse_process_details, parse_process_list, parse_snapshot, parse_socket_listener_snapshot,
    parse_sockets, parse_system_info,
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
echo __PROC__
if command -v top >/dev/null 2>&1; then
    proc_top=$(LC_ALL=C top -b -n 2 -d 0.2 -o %CPU 2>/dev/null | awk '
        function memory_kib(value, suffix, amount) {
            value = tolower(value)
            suffix = substr(value, length(value), 1)
            amount = value + 0
            if (suffix == "p") return amount * 1024 * 1024 * 1024 * 1024
            if (suffix == "t") return amount * 1024 * 1024 * 1024
            if (suffix == "g") return amount * 1024 * 1024
            if (suffix == "m") return amount * 1024
            return amount
        }
        function remember_memory(row, value, i, smallest) {
            if (memory_count < 20) {
                memory_count++
                memory_rows[memory_count] = row
                memory_values[memory_count] = value
                return
            }
            smallest = 1
            for (i = 2; i <= memory_count; i++) {
                if (memory_values[i] < memory_values[smallest]) smallest = i
            }
            if (value > memory_values[smallest]) {
                memory_rows[smallest] = row
                memory_values[smallest] = value
            }
        }
        /^top -/ { sample++; next }
        sample < 2 { next }
        /^%?Cpu/ && !cpu_seen {
            idle = $8
            gsub(/,/, ".", idle)
            wait = $10
            gsub(/,/, ".", wait)
            if (idle != "" && wait != "") {
                cpu = 100 - idle - wait
                if (cpu < 0) cpu = 0
                if (cpu > 100) cpu = 100
                printf "__TOP_CPU__ %.1f\n", cpu
                cpu_seen = 1
            }
            next
        }
        /^[[:space:]]*[0-9]+[[:space:]]/ {
            command = $12
            for (i = 13; i <= NF; i++) command = command " " $i
            res = memory_kib($6)
            cpu = $9
            gsub(/,/, ".", cpu)
            if (res != "" && cpu != "") {
                row = $1 " " $2 " " sprintf("%.0f", res) " " cpu " " $12 " " command
                if (cpu_count < 20) print row
                cpu_count++
                remember_memory(row, res)
            }
        }
        END {
            for (output = 1; output <= memory_count; output++) {
                largest = 1
                for (i = 2; i <= memory_count; i++) {
                    if (memory_values[i] > memory_values[largest]) largest = i
                }
                print memory_rows[largest]
                memory_values[largest] = -1
            }
        }')
    if [ -n "$proc_top" ]; then
        printf '%s\n' "$proc_top"
    else
        ps -eo pid=,user=,rss=,pcpu=,comm=,args= --sort=-pcpu 2>/dev/null | head -n 21 || ps 2>/dev/null
    fi
else
    ps -eo pid=,user=,rss=,pcpu=,comm=,args= --sort=-pcpu 2>/dev/null | head -n 21 || ps 2>/dev/null
fi
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
echo __INTERVAL_CPU__
if command -v top >/dev/null 2>&1; then
    LC_ALL=C top -b -n 2 -d 0.2 2>/dev/null | awk '
        /^top -/ { sample++; next }
        sample < 2 { next }
        /^[[:space:]]*[0-9]+[[:space:]]/ {
            cpu = $9
            gsub(/,/, ".", cpu)
            if (cpu != "") print $1, cpu
        }'
fi
echo __PROCESSES__
ps -eo pid=,user=,rss=,pcpu=,comm=,args= --sort=-pcpu 2>/dev/null || ps 2>/dev/null
"#;

pub const SOCKET_LISTENER_SCRIPT: &str = r#"LC_ALL=C
echo __ADDRESSES__
ip -o addr show 2>/dev/null
echo __SOCKETS4__
ss -H -4lnutp 2>/dev/null
echo __SOCKETS6__
ss -H -6lnutp 2>/dev/null
echo __TCPINFO__
echo __SUMMARIES__
sample_dir="${TMPDIR:-/tmp}/funshell-sockets-$$"
(umask 077 && mkdir "$sample_dir") || exit 0
trap 'rm -rf "$sample_dir"' EXIT HUP INT TERM
ss -H -4tin state connected 2>/dev/null >"$sample_dir/tcp4.a"
ss -H -6tin state connected 2>/dev/null >"$sample_dir/tcp6.a"
sleep 1
ss -H -4tin state connected 2>/dev/null >"$sample_dir/tcp4.b"
ss -H -6tin state connected 2>/dev/null >"$sample_dir/tcp6.b"
ss -H -4un state connected 2>/dev/null >"$sample_dir/udp4.b"
ss -H -6un state connected 2>/dev/null >"$sample_dir/udp6.b"
aggregate_sockets() {
    protocol="$1"
    family="$2"
    before_file="$3"
    after_file="$4"
    with_metrics="$5"
    awk -v protocol="$protocol" -v family="$family" -v with_metrics="$with_metrics" '
function endpoint_host(value, result) {
    result = value
    if (substr(result, 1, 1) == "[") {
        sub(/^\[/, "", result)
        sub(/\]:[^:]*$/, "", result)
    } else {
        sub(/:[^:]*$/, "", result)
    }
    sub(/%.*/, "", result)
    return result
}
function metric_value(line, label, position, value) {
    position = index(line, label)
    if (position == 0) return -1
    value = substr(line, position + length(label))
    sub(/[^0-9].*$/, "", value)
    if (value == "") return -1
    return value + 0
}
FILENAME == ARGV[1] { snapshot = 1 }
FILENAME == ARGV[2] { snapshot = 2 }
$2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && NF >= 5 {
    current_connection = $4 SUBSEP $5
    current_local = $4
    if (snapshot == 1) {
        before_seen[current_connection] = 1
    } else {
        after_seen[current_connection] = 1
        after_local[current_connection] = current_local
        connection_count[current_local]++
        remote = endpoint_host($5)
        unique = current_local SUBSEP remote
        if (remote != "" && remote != "*" && !seen[unique]++) ip_count[current_local]++
    }
    next
}
{
    if (with_metrics != "1" || current_connection == "") next
    sent = metric_value($0, "bytes_sent:")
    received = metric_value($0, "bytes_received:")
    if (snapshot == 1) {
        if (sent >= 0) { before_sent[current_connection] = sent; before_sent_known[current_connection] = 1 }
        if (received >= 0) { before_received[current_connection] = received; before_received_known[current_connection] = 1 }
    } else {
        if (sent >= 0) { after_sent[current_connection] = sent; after_sent_known[current_connection] = 1 }
        if (received >= 0) { after_received[current_connection] = received; after_received_known[current_connection] = 1 }
    }
}
END {
    if (with_metrics == "1") {
        for (connection in after_seen) {
            local = after_local[connection]
            if (after_sent_known[connection] && (!before_seen[connection] || before_sent_known[connection])) {
                previous = before_sent_known[connection] ? before_sent[connection] : 0
                delta = after_sent[connection] - previous
                if (delta >= 0) { sent_bps[local] += delta; sent_known[local] = 1 }
            }
            if (after_received_known[connection] && (!before_seen[connection] || before_received_known[connection])) {
                previous = before_received_known[connection] ? before_received[connection] : 0
                delta = after_received[connection] - previous
                if (delta >= 0) { received_bps[local] += delta; received_known[local] = 1 }
            }
        }
    }
    for (local in connection_count) {
        sent = sent_known[local] ? sprintf("%.0f", sent_bps[local]) : "-"
        received = received_known[local] ? sprintf("%.0f", received_bps[local]) : "-"
        printf "%s\t%s\t%s\t%d\t%d\t%s\t%s\n", protocol, family, local, connection_count[local], ip_count[local], sent, received
    }
}' "$before_file" "$after_file"
}
aggregate_sockets tcp IPv4 "$sample_dir/tcp4.a" "$sample_dir/tcp4.b" 1
aggregate_sockets tcp IPv6 "$sample_dir/tcp6.a" "$sample_dir/tcp6.b" 1
aggregate_sockets udp IPv4 /dev/null "$sample_dir/udp4.b" 0
aggregate_sockets udp IPv6 /dev/null "$sample_dir/udp6.b" 0
"#;

pub fn socket_connection_script(
    protocol: &str,
    address_family: &str,
    local_port: u16,
) -> Option<String> {
    let protocol = protocol.to_ascii_lowercase();
    let protocol_flag = match protocol.as_str() {
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
        "LC_ALL=C\necho __ADDRESSES__\nip -o addr show 2>/dev/null\necho __SOCKETS{family_flag}__\nss -H -{family_flag}{protocol_flag}nap state connected {filter} 2>/dev/null | sed 's/^/{protocol} /'\necho __TCPINFO__\n{tcp_info}\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        PROCESS_SCRIPT, SNAPSHOT_SCRIPT, SOCKET_LISTENER_SCRIPT, socket_connection_script,
    };

    #[test]
    fn samples_process_cpu_from_the_second_top_iteration() {
        assert!(SNAPSHOT_SCRIPT.contains("top -b -n 2 -d 0.2 -o %CPU"));
        assert!(SNAPSHOT_SCRIPT.contains("sample < 2"));
        assert!(SNAPSHOT_SCRIPT.contains("remember_memory(row, res)"));
        assert!(SNAPSHOT_SCRIPT.contains("__TOP_CPU__"));
        assert!(SNAPSHOT_SCRIPT.contains("printf '%s\\n' \"$proc_top\""));
        assert!(SNAPSHOT_SCRIPT.contains("ps -eo pid=,user=,rss=,pcpu=,comm=,args="));
    }

    #[test]
    fn process_list_combines_interval_cpu_with_ps_metadata() {
        assert!(PROCESS_SCRIPT.contains("top -b -n 2 -d 0.2"));
        assert!(PROCESS_SCRIPT.contains("sample < 2"));
        assert!(PROCESS_SCRIPT.contains("echo __INTERVAL_CPU__"));
        assert!(PROCESS_SCRIPT.contains("echo __PROCESSES__"));
        assert!(PROCESS_SCRIPT.contains("ps -eo pid=,user=,rss=,pcpu=,comm=,args="));
    }

    #[test]
    fn filters_socket_details_on_the_remote_host() {
        assert!(SOCKET_LISTENER_SCRIPT.contains("sleep 1"));
        assert!(SOCKET_LISTENER_SCRIPT.contains("after_sent[connection] - previous"));
        assert!(SOCKET_LISTENER_SCRIPT.contains("awk -v protocol="));
        assert!(SOCKET_LISTENER_SCRIPT.contains("echo __SOCKETS4__"));
        assert!(SOCKET_LISTENER_SCRIPT.contains("ss -H -4lnutp"));
        assert!(SOCKET_LISTENER_SCRIPT.contains("echo __SOCKETS6__"));
        assert!(SOCKET_LISTENER_SCRIPT.contains("ss -H -6lnutp"));
        let script = socket_connection_script("tcp", "IPv4", 22).expect("script");
        assert!(script.contains("echo __SOCKETS4__"));
        assert!(script.contains("ss -H -4tnap state connected '( sport = :22 )'"));
        assert!(script.contains("| sed 's/^/tcp /'"));
        assert!(script.contains("ss -H -4tinp state connected '( sport = :22 )'"));
        assert!(!script.contains("ss -H -tunap"));

        let udp = socket_connection_script("udp", "IPv6", 53).expect("UDP script");
        assert!(udp.contains("echo __SOCKETS6__"));
        assert!(udp.contains("ss -H -6unap state connected '( sport = :53 )'"));
        assert!(udp.contains("| sed 's/^/udp /'"));
        assert!(!udp.contains("ss -H -6uinp"));
        assert!(socket_connection_script("raw", "IPv4", 1).is_none());
        assert!(socket_connection_script("tcp", "未知", 1).is_none());
    }
}
