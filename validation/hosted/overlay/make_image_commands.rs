use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

fn main() {
    println!("image clear");
    for index in 0u16..32 {
        let mut wire = [0u8; 70];
        wire[..2].copy_from_slice(&index.to_be_bytes());
        for (offset, byte) in wire[2..66].iter_mut().enumerate() {
            *byte = (index as usize * 64 + offset) as u8;
        }
        let crc = crc32fast::hash(&wire[..66]);
        wire[66..].copy_from_slice(&crc.to_be_bytes());
        println!("image {}", B64.encode(wire));
    }
    println!("image verify");
}
