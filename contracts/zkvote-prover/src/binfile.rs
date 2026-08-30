//! Generic parser for snarkjs "binfile" v1 containers (`.zkey`, `.r1cs`, `.wtns`).
//!
//! Layout:
//! ```text
//! magic "zkey"/"r1cs"/"wtns" (4 bytes)
//! version  u32 LE
//! nSections u32 LE
//! then, for each section:
//!    id    u32 LE
//!    size  u64 LE
//!    data  `size` bytes
//! ```

pub struct Section {
    pub id: u32,
    pub offset: usize,
    pub size: usize,
}

pub struct BinFile<'a> {
    pub version: u32,
    pub sections: Vec<Section>,
    pub data: &'a [u8],
}

impl<'a> BinFile<'a> {
    pub fn parse(buf: &'a [u8], magic: &[u8; 4]) -> Result<Self, String> {
        if buf.len() < 12 {
            return Err("file too short".into());
        }
        if &buf[0..4] != magic {
            return Err(format!(
                "bad magic: expected {:?} got {:?}",
                magic,
                &buf[0..4]
            ));
        }
        let version = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
        let n_sections = u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]) as usize;
        let mut offset = 12usize;
        let mut sections = Vec::with_capacity(n_sections);
        for _ in 0..n_sections {
            if offset + 12 > buf.len() {
                return Err("truncated section header".into());
            }
            let id = u32::from_le_bytes([
                buf[offset],
                buf[offset + 1],
                buf[offset + 2],
                buf[offset + 3],
            ]);
            let size = u64::from_le_bytes([
                buf[offset + 4],
                buf[offset + 5],
                buf[offset + 6],
                buf[offset + 7],
                buf[offset + 8],
                buf[offset + 9],
                buf[offset + 10],
                buf[offset + 11],
            ]) as usize;
            offset += 12;
            if offset + size > buf.len() {
                return Err("section data out of bounds".into());
            }
            sections.push(Section { id, offset, size });
            offset += size;
        }
        Ok(BinFile {
            version,
            sections,
            data: buf,
        })
    }

    pub fn section(&self, id: u32) -> Option<&[u8]> {
        self.sections
            .iter()
            .find(|s| s.id == id)
            .map(|s| &self.data[s.offset..s.offset + s.size])
    }
}
