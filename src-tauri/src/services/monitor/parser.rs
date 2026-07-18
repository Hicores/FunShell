use std::collections::{BTreeMap, HashMap};

use crate::domain::{
    FilesystemInfo, NetworkInterface, ProcessDetails, ProcessInfo, ServerSnapshot, SocketInfo,
    SystemInfo,
};

pub fn parse_snapshot(output: &str) -> ServerSnapshot {
    let sections = sections(output);
    let uptime_seconds = sections
        .get("UPTIME")
        .and_then(|lines| lines.first())
        .and_then(|line| line.split_whitespace().next())
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;
    let load_average = parse_load(sections.get("LOAD"));
    let cpu_percent = parse_cpu(
        sections.get("CPU_A").and_then(|lines| lines.first()),
        sections.get("CPU_B").and_then(|lines| lines.first()),
    );
    let memory = parse_memory(sections.get("MEM"));
    let interfaces = parse_network(sections.get("NET_A"), sections.get("NET_B"));
    let filesystems = parse_filesystems(sections.get("DF"));
    let top_processes = sections
        .get("PROC")
        .map(|lines| parse_processes(&lines.join("\n")))
        .unwrap_or_default();
    ServerSnapshot {
        uptime_seconds,
        load_average,
        cpu_percent,
        memory_total: memory.0,
        memory_used: memory.1,
        swap_total: memory.2,
        swap_used: memory.3,
        interfaces,
        filesystems,
        top_processes,
    }
}

pub fn parse_system_info(output: &str, snapshot: ServerSnapshot) -> SystemInfo {
    let values = output
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect::<HashMap<_, _>>();
    SystemInfo {
        operating_system: values.get("os").copied().unwrap_or("Linux").to_owned(),
        kernel: values.get("kernel").copied().unwrap_or_default().to_owned(),
        kernel_version: values
            .get("kernel_version")
            .copied()
            .unwrap_or_default()
            .to_owned(),
        architecture: values
            .get("architecture")
            .copied()
            .unwrap_or_default()
            .to_owned(),
        hostname: values
            .get("hostname")
            .copied()
            .unwrap_or_default()
            .to_owned(),
        cpu_model: values
            .get("cpu_model")
            .copied()
            .unwrap_or_default()
            .to_owned(),
        cpu_cores: values
            .get("cpu_cores")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        cpu_frequency_mhz: values.get("cpu_mhz").and_then(|value| value.parse().ok()),
        cache: values
            .get("cache")
            .filter(|value| !value.is_empty())
            .map(|value| (*value).to_owned()),
        snapshot,
    }
}

pub fn parse_processes(output: &str) -> Vec<ProcessInfo> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let user = fields.next()?.to_owned();
            let memory_bytes = fields.next()?.parse::<u64>().ok()?.saturating_mul(1024);
            let cpu_percent = fields.next()?.replace(',', ".").parse().ok()?;
            let name = fields.next()?.to_owned();
            let command = fields.collect::<Vec<_>>().join(" ");
            Some(ProcessInfo {
                pid,
                user,
                memory_bytes,
                cpu_percent,
                name,
                command,
            })
        })
        .collect()
}

pub fn parse_process_details(output: &str, pid: u32) -> ProcessDetails {
    let values = sections(output);
    let first = |name: &str| {
        values
            .get(name)
            .and_then(|lines| lines.first())
            .cloned()
            .unwrap_or_default()
    };
    let environment = values
        .get("ENV")
        .into_iter()
        .flatten()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect::<BTreeMap<_, _>>();
    ProcessDetails {
        pid,
        name: first("NAME"),
        executable: first("EXE"),
        working_directory: first("CWD"),
        command: first("CMD"),
        environment,
    }
}

pub fn parse_sockets(output: &str) -> Vec<SocketInfo> {
    let values = sections(output);
    let address_interfaces = values
        .get("ADDRESSES")
        .into_iter()
        .flatten()
        .filter_map(|line| parse_interface_address(line))
        .collect::<HashMap<_, _>>();
    let mut sockets = values
        .get("SOCKETS")
        .into_iter()
        .flatten()
        .filter_map(|line| parse_socket_line(line, &address_interfaces))
        .collect::<Vec<_>>();

    if let Some(lines) = values.get("TCPINFO") {
        let mut last_key: Option<(String, Option<u16>, String, Option<u16>)> = None;
        for line in lines {
            if line.trim_start().starts_with("ESTAB") {
                let fields = line.split_whitespace().collect::<Vec<_>>();
                if fields.len() >= 5 {
                    let (local_address, local_port) = split_endpoint(fields[3]);
                    let (remote_address, remote_port) = split_endpoint(fields[4]);
                    last_key = Some((local_address, local_port, remote_address, remote_port));
                }
                continue;
            }
            if let Some((local_address, local_port, remote_address, remote_port)) = &last_key {
                let sent = metric(line, "bytes_sent:");
                let received = metric(line, "bytes_received:");
                if let Some(socket) = sockets.iter_mut().find(|socket| {
                    socket.local_address == *local_address
                        && socket.local_port == *local_port
                        && socket.remote_address == *remote_address
                        && socket.remote_port == *remote_port
                }) {
                    socket.sent_bytes = sent;
                    socket.received_bytes = received;
                }
            }
        }
    }
    sockets
}

fn sections(output: &str) -> HashMap<String, Vec<String>> {
    let mut result = HashMap::<String, Vec<String>>::new();
    let mut current: Option<String> = None;
    for line in output.lines() {
        if line.starts_with("__") && line.ends_with("__") {
            let name = line.trim_matches('_').to_owned();
            result.entry(name.clone()).or_default();
            current = Some(name);
        } else if let Some(name) = &current {
            result
                .entry(name.clone())
                .or_default()
                .push(line.to_owned());
        }
    }
    result
}

fn parse_load(lines: Option<&Vec<String>>) -> [f64; 3] {
    let values = lines
        .and_then(|lines| lines.first())
        .map(|line| {
            line.split_whitespace()
                .take(3)
                .filter_map(|value| value.parse().ok())
                .collect::<Vec<f64>>()
        })
        .unwrap_or_default();
    [
        values.first().copied().unwrap_or(0.0),
        values.get(1).copied().unwrap_or(0.0),
        values.get(2).copied().unwrap_or(0.0),
    ]
}

fn parse_cpu(first: Option<&String>, second: Option<&String>) -> f64 {
    fn sample(line: Option<&String>) -> (u64, u64) {
        let values = line
            .into_iter()
            .flat_map(|line| line.split_whitespace().skip(1))
            .filter_map(|value| value.parse::<u64>().ok())
            .collect::<Vec<_>>();
        let total = values.iter().sum();
        let idle = values.get(3).copied().unwrap_or(0) + values.get(4).copied().unwrap_or(0);
        (total, idle)
    }
    let (first_total, first_idle) = sample(first);
    let (second_total, second_idle) = sample(second);
    let total = second_total.saturating_sub(first_total);
    let idle = second_idle.saturating_sub(first_idle);
    if total == 0 {
        0.0
    } else {
        ((total.saturating_sub(idle)) as f64 / total as f64 * 1000.0).round() / 10.0
    }
}

fn parse_memory(lines: Option<&Vec<String>>) -> (u64, u64, u64, u64) {
    let values = lines
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let kb = value.split_whitespace().next()?.parse::<u64>().ok()?;
            Some((key, kb.saturating_mul(1024)))
        })
        .collect::<HashMap<_, _>>();
    let total = values.get("MemTotal").copied().unwrap_or(0);
    let available = values
        .get("MemAvailable")
        .or_else(|| values.get("MemFree"))
        .copied()
        .unwrap_or(0);
    let swap_total = values.get("SwapTotal").copied().unwrap_or(0);
    let swap_free = values.get("SwapFree").copied().unwrap_or(0);
    (
        total,
        total.saturating_sub(available),
        swap_total,
        swap_total.saturating_sub(swap_free),
    )
}

fn parse_network(
    first: Option<&Vec<String>>,
    second: Option<&Vec<String>>,
) -> Vec<NetworkInterface> {
    fn values(lines: Option<&Vec<String>>) -> HashMap<String, (u64, u64)> {
        lines
            .into_iter()
            .flatten()
            .filter_map(|line| {
                let (name, data) = line.split_once(':')?;
                let fields = data.split_whitespace().collect::<Vec<_>>();
                Some((
                    name.trim().to_owned(),
                    (fields.first()?.parse().ok()?, fields.get(8)?.parse().ok()?),
                ))
            })
            .collect()
    }
    let first = values(first);
    let second = values(second);
    let mut output = second
        .into_iter()
        .map(|(name, (received, transmitted))| {
            let (old_received, old_transmitted) = first.get(&name).copied().unwrap_or_default();
            NetworkInterface {
                name,
                received_bytes: received,
                transmitted_bytes: transmitted,
                receive_bps: received.saturating_sub(old_received).saturating_mul(5),
                transmit_bps: transmitted
                    .saturating_sub(old_transmitted)
                    .saturating_mul(5),
            }
        })
        .collect::<Vec<_>>();
    output.sort_by(|a, b| a.name.cmp(&b.name));
    output
}

fn parse_filesystems(lines: Option<&Vec<String>>) -> Vec<FilesystemInfo> {
    lines
        .into_iter()
        .flatten()
        .skip(1)
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 6 {
                return None;
            }
            let total = fields.get(1)?.parse().ok()?;
            let used = fields.get(2)?.parse().ok()?;
            let available = fields.get(3)?.parse().ok()?;
            let usage_percent = fields.get(4)?.trim_end_matches('%').parse().ok()?;
            Some(FilesystemInfo {
                device: fields.first()?.to_string(),
                mount_point: fields[5..].join(" "),
                total,
                used,
                available,
                usage_percent,
            })
        })
        .collect()
}

fn parse_socket_line(
    line: &str,
    address_interfaces: &HashMap<String, String>,
) -> Option<SocketInfo> {
    let fields = line.split_whitespace().collect::<Vec<_>>();
    if fields.len() < 6 {
        return None;
    }
    let (local_address, local_port) = split_endpoint(fields[4]);
    let (remote_address, remote_port) = split_endpoint(fields[5]);
    let process_field = fields.get(6..).unwrap_or_default().join(" ");
    let pid = extract_number_after(&process_field, "pid=");
    let process = process_field
        .split("((\"")
        .nth(1)
        .and_then(|value| value.split('"').next())
        .map(str::to_owned);
    let address_family = socket_address_family(&local_address, &remote_address).to_owned();
    let interface_name = socket_interface(&local_address, address_interfaces);
    Some(SocketInfo {
        protocol: fields[0].to_owned(),
        address_family,
        interface_name,
        state: fields[1].to_owned(),
        local_address,
        local_port,
        remote_address,
        remote_port,
        pid,
        process,
        received_bytes: None,
        sent_bytes: None,
    })
}

fn parse_interface_address(line: &str) -> Option<(String, String)> {
    let fields = line.split_whitespace().collect::<Vec<_>>();
    if fields.len() < 4 || !matches!(fields[2], "inet" | "inet6") {
        return None;
    }
    let address = fields[3].split('/').next()?.split('%').next()?.to_owned();
    let interface = fields[1].split('@').next()?.to_owned();
    Some((address, interface))
}

fn socket_address_family(local_address: &str, remote_address: &str) -> &'static str {
    let address = if matches!(local_address, "*" | "") {
        remote_address
    } else {
        local_address
    };
    if address.contains(':') {
        "IPv6"
    } else if address.contains('.') {
        "IPv4"
    } else {
        "未知"
    }
}

fn socket_interface(
    local_address: &str,
    address_interfaces: &HashMap<String, String>,
) -> Option<String> {
    if matches!(local_address, "0.0.0.0" | "::" | "*") {
        return None;
    }
    if let Some((_, interface)) = local_address.rsplit_once('%') {
        return Some(interface.to_owned());
    }
    let address = local_address.split('%').next().unwrap_or(local_address);
    address_interfaces
        .get(address)
        .cloned()
        .or_else(|| matches!(address, "127.0.0.1" | "::1").then(|| "lo".to_owned()))
}

fn split_endpoint(value: &str) -> (String, Option<u16>) {
    match value.rsplit_once(':') {
        Some((address, port)) => (
            address.trim_matches(['[', ']']).to_owned(),
            port.parse().ok(),
        ),
        None => (value.to_owned(), None),
    }
}

fn metric(line: &str, name: &str) -> Option<u64> {
    let rest = line.split(name).nth(1)?;
    rest.split_whitespace().next()?.parse().ok()
}

fn extract_number_after(value: &str, marker: &str) -> Option<u32> {
    value
        .split(marker)
        .nth(1)?
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::{parse_processes, parse_snapshot, parse_sockets};

    #[test]
    fn parses_core_snapshot_values() {
        let output = "__UPTIME__\n120.4 20\n__LOAD__\n0.10 0.20 0.30 1/100\n__CPU_A__\ncpu 100 0 50 850 0 0 0\n__NET_A__\neth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n__CPU_B__\ncpu 120 0 60 920 0 0 0\n__NET_B__\neth0: 1200 0 0 0 0 0 0 0 2500 0 0 0 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 500 kB\nSwapFree: 300 kB\n__DF__\nFilesystem 1-blocks Used Available Use% Mounted on\n/dev/a 1000 600 400 60% /\n__PROC__\n1 root 100 2.5 init /sbin/init\n";
        let snapshot = parse_snapshot(output);
        assert_eq!(snapshot.uptime_seconds, 120);
        assert_eq!(snapshot.memory_used, 600 * 1024);
        assert_eq!(snapshot.interfaces[0].receive_bps, 1000);
        assert_eq!(snapshot.top_processes[0].pid, 1);
    }

    #[test]
    fn parses_process_rows() {
        let rows = parse_processes("42 root 2048 1.5 sshd /usr/sbin/sshd -D");
        assert_eq!(rows[0].memory_bytes, 2 * 1024 * 1024);
        assert_eq!(rows[0].command, "/usr/sbin/sshd -D");
    }

    #[test]
    fn associates_tcp_counters_with_ipv6_socket_endpoints() {
        let output = "__ADDRESSES__\n1: lo    inet6 ::1/128 scope host lo\n__SOCKETS__\ntcp LISTEN 0 4096 [::]:80 [::]:* users:((\"nginx\",pid=10,fd=3))\ntcp ESTAB 0 0 [::1]:80 [2001:db8::2]:45120 users:((\"nginx\",pid=10,fd=4))\n__TCPINFO__\nESTAB 0 0 [::1]:80 [2001:db8::2]:45120 users:((\"nginx\",pid=10,fd=4))\n cubic bytes_sent:9000 bytes_received:5000\n";
        let sockets = parse_sockets(output);
        assert_eq!(sockets.len(), 2);
        assert_eq!(sockets[0].address_family, "IPv6");
        assert_eq!(sockets[0].interface_name, None);
        assert_eq!(sockets[1].interface_name.as_deref(), Some("lo"));
        assert_eq!(sockets[1].sent_bytes, Some(9000));
        assert_eq!(sockets[1].received_bytes, Some(5000));
    }

    #[test]
    fn maps_bound_addresses_to_network_interfaces() {
        let output = "__ADDRESSES__\n2: eth0@if9    inet 10.0.0.2/24 brd 10.0.0.255 scope global eth0\n3: eth1    inet6 2001:db8::10/64 scope global\n__SOCKETS__\ntcp LISTEN 0 4096 10.0.0.2:443 0.0.0.0:* users:((\"nginx\",pid=10,fd=3))\ntcp LISTEN 0 4096 [2001:db8::10]:443 [::]:* users:((\"nginx\",pid=10,fd=4))\n__TCPINFO__\n";
        let sockets = parse_sockets(output);
        assert_eq!(sockets[0].address_family, "IPv4");
        assert_eq!(sockets[0].interface_name.as_deref(), Some("eth0"));
        assert_eq!(sockets[1].address_family, "IPv6");
        assert_eq!(sockets[1].interface_name.as_deref(), Some("eth1"));
    }
}
