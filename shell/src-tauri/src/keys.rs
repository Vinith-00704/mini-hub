//! The two keys the shell hands the core: the database key, kept by Windows Credential Manager, and the person key,
//! made new at every start and kept only in memory (docs/03-security-and-permissions.md > Keys and secrets).

/// Where the database key is kept. The real one is Windows Credential Manager; tests use memory.
pub trait KeyStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, key: &str) -> Result<(), String>;
}

/// 32 random bytes as 64 lowercase hex characters.
pub fn new_key() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("Windows gave no random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_key(k: &str) -> bool {
    k.len() == 64 && k.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// The database key. A new one is made only when there is no key **and** no database yet: making a new key for an
/// existing database would lock the owner out of their own data.
pub fn database_key(store: &dyn KeyStore, db_exists: bool) -> Result<String, String> {
    match store.get()? {
        Some(k) if is_key(&k) => Ok(k),
        Some(_) => Err("The hub's key in Windows Credential Manager is damaged. Restore it from a backup.".into()),
        None if db_exists => Err(
            "The hub's key is missing from Windows. Restore it from a backup, or move hub.db away to start fresh.".into(),
        ),
        None => {
            let k = new_key();
            store.set(&k)?;
            Ok(k)
        }
    }
}

/// Windows Credential Manager, through the `keyring` crate.
pub struct CredentialStore {
    pub account: String,
}

const SERVICE: &str = "MiniHub";

impl CredentialStore {
    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, &self.account).map_err(|e| format!("Windows Credential Manager: {e}"))
    }
}

impl KeyStore for CredentialStore {
    fn get(&self) -> Result<Option<String>, String> {
        match self.entry()?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Windows Credential Manager: {e}")),
        }
    }
    fn set(&self, key: &str) -> Result<(), String> {
        self.entry()?.set_password(key).map_err(|e| format!("Windows Credential Manager: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Memory(RefCell<Option<String>>);
    impl KeyStore for Memory {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.borrow().clone())
        }
        fn set(&self, key: &str) -> Result<(), String> {
            *self.0.borrow_mut() = Some(key.to_string());
            Ok(())
        }
    }

    #[test]
    fn new_keys_are_64_hex_and_differ() {
        let a = new_key();
        let b = new_key();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(a, b);
    }

    #[test]
    fn makes_a_key_only_when_there_is_no_database() {
        let store = Memory(RefCell::new(None));
        let made = database_key(&store, false).unwrap();
        assert_eq!(made.len(), 64);
        assert_eq!(store.get().unwrap(), Some(made.clone()));
        assert_eq!(database_key(&store, true).unwrap(), made, "the stored key is used from then on");
    }

    #[test]
    fn refuses_to_make_a_new_key_for_an_existing_database() {
        let store = Memory(RefCell::new(None));
        let err = database_key(&store, true).unwrap_err();
        assert!(err.contains("missing"), "{err}");
        assert_eq!(store.get().unwrap(), None, "nothing was stored");
    }

    #[test]
    fn a_damaged_stored_key_is_an_error() {
        let store = Memory(RefCell::new(Some("not hex".into())));
        assert!(database_key(&store, true).is_err());
    }
}
