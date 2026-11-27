use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabHostInfo {
    pub ip: String,
    pub hostname: String,
    pub in_domain: bool,
    pub port: u16,
}

struct ServerHub {
    next_id: u64,
    clients: HashMap<u64, Sender<String>>,
    topics: HashMap<String, HashSet<u64>>,
}

impl ServerHub {
    fn new() -> Self {
        Self {
            next_id: 1,
            clients: HashMap::new(),
            topics: HashMap::new(),
        }
    }

    fn register(&mut self, tx: Sender<String>) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.clients.insert(id, tx);
        id
    }

    fn unregister(&mut self, id: u64) {
        self.clients.remove(&id);
        for members in self.topics.values_mut() {
            members.remove(&id);
        }
        self.topics.retain(|_, members| !members.is_empty());
    }

    fn subscribe(&mut self, id: u64, topic: String) {
        self.topics.entry(topic).or_default().insert(id);
    }

    fn unsubscribe(&mut self, id: u64, topic: &str) {
        if let Some(members) = self.topics.get_mut(topic) {
            members.remove(&id);
            if members.is_empty() {
                self.topics.remove(topic);
            }
        }
    }

    fn publish(&self, topic: &str, payload: &str) {
        if let Some(members) = self.topics.get(topic) {
            for &peer_id in members {
                if let Some(tx) = self.clients.get(&peer_id) {
                    let _ = tx.send(payload.to_string());
                }
            }
        }
    }
}

fn detect_lan_ip() -> String {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if !ip.starts_with("127.") && ip != "0.0.0.0" {
                    return ip;
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

fn detect_hostname() -> (String, bool) {
    let comp = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let domain = std::env::var("USERDNSDOMAIN")
        .unwrap_or_default()
        .trim()
        .to_string();

    if !comp.is_empty() && !domain.is_empty() {
        (format!("{}.{}", comp.to_lowercase(), domain.to_lowercase()), true)
    } else if !comp.is_empty() {
        (comp.to_lowercase(), false)
    } else {
        (String::new(), false)
    }
}

// --- Minimal zero-dependency RFC 6455 WebSocket (SHA-1 + Base64 + framing) ---

fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1u32),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDCu32),
                _ => (b ^ c ^ d, 0xCA62C1D6u32),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn ws_handshake(stream: &mut TcpStream) -> bool {
    let mut buf = [0u8; 4096];
    let mut total = 0usize;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    while total < buf.len() {
        match stream.read(&mut buf[total..]) {
            Ok(0) => return false,
            Ok(n) => {
                total += n;
                if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return false,
        }
    }
    let req = String::from_utf8_lossy(&buf[..total]);
    let key = req
        .lines()
        .find_map(|line| {
            let (k, v) = line.split_once(':')?;
            if k.trim().eq_ignore_ascii_case("sec-websocket-key") {
                Some(v.trim().to_string())
            } else {
                None
            }
        });
    let Some(key) = key else { return false };
    let accept_src = format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    let accept_val = base64_encode(&sha1(accept_src.as_bytes()));
    let resp = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept_val}\r\n\r\n"
    );
    stream.write_all(resp.as_bytes()).is_ok()
}

fn ws_send_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut header = Vec::with_capacity(10);
    header.push(0x80 | (opcode & 0x0F));
    let len = payload.len();
    if len < 126 {
        header.push(len as u8);
    } else if len <= 65535 {
        header.push(126);
        header.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        header.push(127);
        header.extend_from_slice(&(len as u64).to_be_bytes());
    }
    stream.write_all(&header)?;
    stream.write_all(payload)
}

enum WsRead {
    Frame(u8, Vec<u8>),
    Timeout,
    Closed,
}

fn read_exact_or_timeout(stream: &mut TcpStream, buf: &mut [u8], allow_first_timeout: bool) -> Result<(), bool> {
    let mut offset = 0;
    while offset < buf.len() {
        match stream.read(&mut buf[offset..]) {
            Ok(0) => return Err(false),
            Ok(n) => offset += n,
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                if allow_first_timeout && offset == 0 {
                    return Err(true);
                }
                return Err(false);
            }
            Err(_) => return Err(false),
        }
    }
    Ok(())
}

fn ws_read_frame(stream: &mut TcpStream) -> WsRead {
    let mut hdr = [0u8; 2];
    match read_exact_or_timeout(stream, &mut hdr, true) {
        Ok(()) => {}
        Err(true) => return WsRead::Timeout,
        Err(false) => return WsRead::Closed,
    }
    let opcode = hdr[0] & 0x0F;
    let masked = (hdr[1] & 0x80) != 0;
    let mut len = (hdr[1] & 0x7F) as u64;
    if len == 126 {
        let mut ext = [0u8; 2];
        if read_exact_or_timeout(stream, &mut ext, false).is_err() {
            return WsRead::Closed;
        }
        len = u16::from_be_bytes(ext) as u64;
    } else if len == 127 {
        let mut ext = [0u8; 8];
        if read_exact_or_timeout(stream, &mut ext, false).is_err() {
            return WsRead::Closed;
        }
        len = u64::from_be_bytes(ext);
    }
    if len > 16 * 1024 * 1024 {
        return WsRead::Closed;
    }
    let mut mask = [0u8; 4];
    if masked && read_exact_or_timeout(stream, &mut mask, false).is_err() {
        return WsRead::Closed;
    }
    let mut payload = vec![0u8; len as usize];
    if len > 0 && read_exact_or_timeout(stream, &mut payload, false).is_err() {
        return WsRead::Closed;
    }
    if masked {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i % 4];
        }
    }
    WsRead::Frame(opcode, payload)
}

fn handle_client(mut stream: TcpStream, hub: Arc<Mutex<ServerHub>>) {
    if !ws_handshake(&mut stream) {
        return;
    }
    let _ = stream.set_read_timeout(Some(Duration::from_millis(25)));

    let (tx, rx) = mpsc::channel::<String>();
    let client_id = {
        let Ok(mut h) = hub.lock() else { return };
        h.register(tx)
    };

    loop {
        while let Ok(out_msg) = rx.try_recv() {
            if ws_send_frame(&mut stream, 0x1, out_msg.as_bytes()).is_err() {
                if let Ok(mut h) = hub.lock() {
                    h.unregister(client_id);
                }
                return;
            }
        }

        match ws_read_frame(&mut stream) {
            WsRead::Frame(0x1, payload) => {
                if let Ok(text) = String::from_utf8(payload) {
                    if let Ok(val) = serde_json::from_str::<Value>(&text) {
                        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        match msg_type {
                            "subscribe" => {
                                if let Some(topics) = val.get("topics").and_then(|v| v.as_array()) {
                                    if let Ok(mut h) = hub.lock() {
                                        for t in topics.iter().filter_map(|v| v.as_str()) {
                                            h.subscribe(client_id, t.to_string());
                                        }
                                    }
                                }
                            }
                            "unsubscribe" => {
                                if let Some(topics) = val.get("topics").and_then(|v| v.as_array()) {
                                    if let Ok(mut h) = hub.lock() {
                                        for t in topics.iter().filter_map(|v| v.as_str()) {
                                            h.unsubscribe(client_id, t);
                                        }
                                    }
                                }
                            }
                            "publish" => {
                                if let Some(topic) = val.get("topic").and_then(|v| v.as_str()) {
                                    if let Ok(h) = hub.lock() {
                                        h.publish(topic, &text);
                                    }
                                }
                            }
                            "ping" => {
                                let _ = ws_send_frame(&mut stream, 0x1, br#"{"type":"pong"}"#);
                            }
                            _ => {}
                        }
                    }
                }
            }
            WsRead::Frame(0x9, payload) => {
                let _ = ws_send_frame(&mut stream, 0xA, &payload);
            }
            WsRead::Frame(0x8, _) => break,
            WsRead::Frame(_, _) => {}
            WsRead::Timeout => {}
            WsRead::Closed => break,
        }
    }

    if let Ok(mut h) = hub.lock() {
        h.unregister(client_id);
    }
}

static RUNNING_PORT: OnceLock<u16> = OnceLock::new();

pub fn ensure_collab_server() -> Result<CollabHostInfo, String> {
    let port = if let Some(&p) = RUNNING_PORT.get() {
        p
    } else {
        let listener = TcpListener::bind("0.0.0.0:4444")
            .or_else(|_| TcpListener::bind("0.0.0.0:0"))
            .map_err(|e| format!("Failed to bind collab signaling server: {e}"))?;
        let bound_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {e}"))?
            .port();
        let hub = Arc::new(Mutex::new(ServerHub::new()));
        thread::spawn(move || {
            for incoming in listener.incoming().flatten() {
                let hub_clone = Arc::clone(&hub);
                thread::spawn(move || handle_client(incoming, hub_clone));
            }
        });
        let _ = RUNNING_PORT.set(bound_port);
        bound_port
    };

    let ip = detect_lan_ip();
    let (hostname, in_domain) = detect_hostname();
    Ok(CollabHostInfo {
        ip,
        hostname,
        in_domain,
        port,
    })
}
