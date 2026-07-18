use dashmap::DashMap;
use tokio_util::sync::CancellationToken;

pub struct TransferManager {
    tasks: DashMap<String, CancellationToken>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            tasks: DashMap::new(),
        }
    }

    pub fn start(&self, task_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.tasks.insert(task_id.to_owned(), token.clone());
        token
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        self.tasks.get(task_id).is_some_and(|task| {
            task.cancel();
            true
        })
    }

    pub fn finish(&self, task_id: &str) {
        self.tasks.remove(task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::TransferManager;

    #[test]
    fn cancels_and_removes_running_tasks() {
        let manager = TransferManager::new();
        let token = manager.start("task-1");
        assert!(manager.cancel("task-1"));
        assert!(token.is_cancelled());
        manager.finish("task-1");
        assert!(!manager.cancel("task-1"));
    }
}
