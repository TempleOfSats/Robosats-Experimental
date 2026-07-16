use data_encoding::HEXLOWER;
use sha2::{Digest, Sha512};

use crate::error::Error;

pub(crate) fn sha512_digest(string: &str) -> Result<String, Error> {
    Ok(HEXLOWER.encode(&Sha512::digest(string.as_bytes())))
}

pub(crate) fn split_hash(hash: &str, chunks: usize) -> Result<Vec<i64>, Error> {
    let mut vector: Vec<i64> = Vec::with_capacity(chunks);
    for i in 0..chunks {
        let block_size = hash.len() / chunks;
        let current_start = (1 + i) * block_size - block_size;
        let current_end = (1 + i) * block_size;
        let slot = &hash[current_start..current_end];
        let slot = i64::from_str_radix(slot, 16)?;
        vector.push(slot);
    }

    vector.append(&mut vector.clone());
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha512_digest_returns_hash_of_provided_string() {
        let initial_string = "initial_string";
        let expected_hash = "92ba5204aca5e21f60d40dda5b64e0e64e46028da5d33d2b577a0c80b6ed2843b46a458bbb0023d2634ecc7bccb2678e0b33f5ec0144fb124174325113396ef4";
        let hash = sha512_digest(initial_string);
        assert_eq!(hash.unwrap(), expected_hash)
    }

    #[test]
    fn split_hash_returns_given_number_of_chunks_of_a_string() {
        let string = "92ba5204aca5e21f60d40dda5b64e0e64e46028da5d33d2b577a0c80b6ed2843b46a458bbb0023d2634ecc7bccb2678e0b33f5ec0144fb124174325113396ef4";
        let chunks = 11;
        let vec_of_strings = split_hash(string, chunks);
        assert_eq!(vec_of_strings.unwrap().len(), chunks * 2);
    }
}
