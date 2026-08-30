use zkvote_prover::binfile::BinFile;

fn main() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    let path = root.join("frontend/public/circuits/vote_final.zkey");
    let bytes = std::fs::read(&path).unwrap();
    let bf = BinFile::parse(&bytes, b"zkey").unwrap();
    for s in &bf.sections {
        println!(
            "section id={} offset={} size={} (expected points if g1: {})",
            s.id,
            s.offset,
            s.size,
            s.size / 64
        );
    }

    use zkvote_prover::field::{fq_to_bigint, read_g1};
    let s5 = bf.section(5).unwrap();
    let p0 = read_g1(&s5[0..64]);
    println!(
        "A[0] on_curve={} coords=({}, {})",
        p0.is_on_curve(),
        fq_to_bigint(&p0.x),
        fq_to_bigint(&p0.y)
    );
    let s3 = bf.section(3).unwrap();
    let ic0 = read_g1(&s3[0..64]);
    println!(
        "IC[0] on_curve={} coords=({}, {})",
        ic0.is_on_curve(),
        fq_to_bigint(&ic0.x),
        fq_to_bigint(&ic0.y)
    );
    println!("expected IC[0] = (1595079754786474524782634392987563200078137952100286780649827946580336693634, 3350275067114545658850692684296785324189490349157628830225816103801571300687)");
}
