use std::sync::Arc;

use serde::Serialize;
use tokio::sync::watch;

use crate::app::AppState;

pub(crate) type AppHandle = Arc<RuntimeHandle>;
pub(crate) type State<'a, T> = &'a T;

pub(crate) struct RuntimeHandle {
    state: AppState,
    shutdown_tx: watch::Sender<bool>,
}

impl RuntimeHandle {
    pub(crate) fn new() -> (AppHandle, watch::Receiver<bool>) {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        (
            Arc::new(Self {
                state: AppState::default(),
                shutdown_tx,
            }),
            shutdown_rx,
        )
    }

    pub(crate) fn state(&self) -> State<'_, AppState> {
        &self.state
    }

    pub(crate) fn exit(&self, _code: i32) {
        let _ = self.shutdown_tx.send(true);
    }

    pub(crate) fn emit<T: Serialize>(&self, _event: &str, _payload: T) -> Result<(), String> {
        Ok(())
    }
}
