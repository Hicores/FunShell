use rusqlite::params;

use crate::{domain::TransferProgressEvent, error::AppResult, persistence::Database};

const MAX_TRANSFER_HISTORY: u32 = 500;

impl Database {
    pub fn save_transfer(&self, transfer: &TransferProgressEvent) -> AppResult<()> {
        let transferred = i64::try_from(transfer.transferred).unwrap_or(i64::MAX);
        let total = i64::try_from(transfer.total).unwrap_or(i64::MAX);
        self.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "INSERT INTO transfer_history(
                    task_id,session_id,direction,source,destination,transferred,total,state,updated_at,viewed
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(task_id) DO UPDATE SET
                    session_id=excluded.session_id,direction=excluded.direction,
                    source=excluded.source,destination=excluded.destination,
                    transferred=excluded.transferred,total=excluded.total,
                    state=excluded.state,updated_at=excluded.updated_at",
                params![
                    transfer.task_id,
                    transfer.session_id,
                    transfer.direction,
                    transfer.source,
                    transfer.destination,
                    transferred,
                    total,
                    transfer.state,
                    transfer.updated_at,
                    transfer.viewed as i64,
                ],
            )?;
            transaction.execute(
                "DELETE FROM transfer_history WHERE task_id IN (
                    SELECT task_id FROM transfer_history
                    ORDER BY updated_at DESC LIMIT -1 OFFSET ?1
                 )",
                [MAX_TRANSFER_HISTORY],
            )?;
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn list_transfers(&self, limit: u32) -> AppResult<Vec<TransferProgressEvent>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT session_id,task_id,direction,source,destination,transferred,total,state,updated_at,viewed
                 FROM transfer_history ORDER BY updated_at DESC LIMIT ?1",
            )?;
            let rows = statement.query_map([limit.min(MAX_TRANSFER_HISTORY)], |row| {
                Ok(TransferProgressEvent {
                    session_id: row.get(0)?,
                    task_id: row.get(1)?,
                    direction: row.get(2)?,
                    source: row.get(3)?,
                    destination: row.get(4)?,
                    transferred: row.get::<_, i64>(5)?.max(0) as u64,
                    total: row.get::<_, i64>(6)?.max(0) as u64,
                    state: row.get(7)?,
                    updated_at: row.get(8)?,
                    viewed: row.get::<_, i64>(9)? != 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn mark_transfers_viewed(&self) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("UPDATE transfer_history SET viewed=1 WHERE viewed=0", [])?;
            Ok(())
        })
    }

    pub fn clear_completed_transfers(&self) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM transfer_history WHERE state<>'running'", [])?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{domain::TransferProgressEvent, persistence::Database};

    fn completed_transfer() -> TransferProgressEvent {
        TransferProgressEvent {
            session_id: "session-1".into(),
            task_id: "task-1".into(),
            direction: "download".into(),
            source: "/root/archive.tar".into(),
            destination: "C:\\downloads\\archive.tar".into(),
            transferred: 1024,
            total: 1024,
            state: "completed".into(),
            updated_at: "2026-07-18T10:00:00Z".into(),
            viewed: false,
        }
    }

    #[test]
    fn persists_views_and_clears_transfer_history() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("test.db");
        Database::open(&path)
            .expect("database")
            .save_transfer(&completed_transfer())
            .expect("save transfer");

        let database = Database::open(&path).expect("reopen database");
        let transfers = database.list_transfers(100).expect("list transfers");
        assert_eq!(transfers.len(), 1);
        assert_eq!(transfers[0].destination, "C:\\downloads\\archive.tar");
        assert!(!transfers[0].viewed);

        database.mark_transfers_viewed().expect("mark viewed");
        assert!(database.list_transfers(100).expect("list viewed")[0].viewed);
        let mut final_update = completed_transfer();
        final_update.viewed = false;
        database
            .save_transfer(&final_update)
            .expect("save final update");
        assert!(
            database.list_transfers(100).expect("list updated")[0].viewed,
            "progress updates must preserve the viewed state"
        );
        database.clear_completed_transfers().expect("clear history");
        assert!(
            database
                .list_transfers(100)
                .expect("list cleared")
                .is_empty()
        );
    }

    #[test]
    fn marks_interrupted_transfers_as_canceled_on_restart() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("test.db");
        let mut transfer = completed_transfer();
        transfer.state = "running".into();
        transfer.transferred = 128;
        Database::open(&path)
            .expect("database")
            .save_transfer(&transfer)
            .expect("save transfer");

        let database = Database::open(&path).expect("reopen database");
        assert_eq!(
            database.list_transfers(100).expect("list transfers")[0].state,
            "canceled"
        );
    }
}
