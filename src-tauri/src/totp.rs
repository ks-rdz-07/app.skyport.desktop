//! Two-step verification: RFC 6238 TOTP (30 s, 6 digits, SHA-1), which every
//! authenticator app supports, plus single-use recovery codes.
use hmac::{Hmac, Mac};
use sha1::Sha1;

pub fn code_at(secret: &[u8], unix: u64) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("any key length");
    mac.update(&(unix / 30).to_be_bytes());
    let h = mac.finalize().into_bytes();
    let o = (h[19] & 0x0f) as usize;
    let bin = (u32::from(h[o]) & 0x7f) << 24 | u32::from(h[o + 1]) << 16 | u32::from(h[o + 2]) << 8 | u32::from(h[o + 3]);
    bin % 1_000_000
}

/// Accepts the current code and one step either side (clock drift).
pub fn verify(secret: &[u8], code: &str, unix: u64) -> bool {
    let code = code.trim().replace(' ', "");
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    [unix.saturating_sub(30), unix, unix + 30].iter().fold(false, |ok, t| ok | ct_eq(&format!("{:06}", code_at(secret, *t)), &code))
}

pub fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn base32(bytes: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let (mut out, mut buf, mut bits) = (String::new(), 0u32, 0);
    for &b in bytes {
        buf = buf << 8 | u32::from(b);
        bits += 8;
        while bits >= 5 {
            out.push(A[(buf >> (bits - 5) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(A[(buf << (5 - bits) & 31) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_vectors() {
        let s = b"12345678901234567890";
        assert_eq!(code_at(s, 59), 287082);
        assert_eq!(code_at(s, 1111111109), 81804);
        assert_eq!(code_at(s, 2000000000), 279037);
        assert!(verify(s, "287 082", 59));
        assert!(verify(s, "287082", 80)); // one step later still accepted
        assert!(!verify(s, "287082", 200));
        assert!(!verify(s, "28708a", 59));
    }

    #[test]
    fn base32_rfc4648() {
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
        assert_eq!(base32(b"12345678901234567890"), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    }
}
