package app.minihub.phone.data

import android.content.ContentValues
import android.content.Context
import app.minihub.phone.consent.AuditRow
import app.minihub.phone.consent.AuditStore
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper

/**
 * The phone's record on disk, encrypted with SQLCipher (docs/08 > Packages: data). The key comes from [Sealed]
 * and never leaves the phone. Events are numbered by their row id, which only grows (AUTOINCREMENT), so a number
 * is never used twice even after a delete.
 */
class RecordDb(context: Context) : RecordStore, AuditStore {
    private val helper: SQLiteOpenHelper

    init {
        System.loadLibrary("sqlcipher")
        val key = Sealed.databaseKey(context.noBackupFilesDir)
        helper = object : SQLiteOpenHelper(context, "record.db", key, null, 2, 0, null, null, true) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE events (
                        seq INTEGER PRIMARY KEY AUTOINCREMENT,
                        type TEXT NOT NULL,
                        occurred_at INTEGER NOT NULL,
                        who TEXT, who_key TEXT, app TEXT, title TEXT, body TEXT, data TEXT
                    )""",
                )
                db.execSQL("CREATE INDEX events_time ON events (occurred_at)")
                db.execSQL("CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL, scope TEXT, outcome TEXT NOT NULL, detail TEXT)")
                createSeen(db)
            }

            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
                if (oldVersion < 2) createSeen(db)
            }

            /** Fingerprints of what was recorded in the last 7 days, so a repeat is folded (docs/04). */
            private fun createSeen(db: SQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS seen (fp TEXT PRIMARY KEY, at INTEGER NOT NULL)")
            }
        }
    }

    private val db get() = helper.writableDatabase

    override fun insert(e: NewEvent): Long = db.insertOrThrow("events", null, values(e))

    override fun insertOnce(fp: String, at: Long, e: NewEvent): Long? {
        db.beginTransaction()
        try {
            val known = db.insertWithOnConflict("seen", null, ContentValues().apply { put("fp", fp); put("at", at) }, SQLiteDatabase.CONFLICT_IGNORE) == -1L
            if (known) return null
            val seq = db.insertOrThrow("events", null, values(e))
            db.setTransactionSuccessful()
            return seq
        } finally {
            db.endTransaction()
        }
    }

    override fun prune(ackedUpTo: Long, before: Long): Int {
        db.beginTransaction()
        try {
            val gone = db.delete("events", "seq <= ? AND occurred_at < ?", arrayOf(ackedUpTo.toString(), before.toString()))
            db.delete("seen", "at < ?", arrayOf(before.toString()))
            db.setTransactionSuccessful()
            return gone
        } finally {
            db.endTransaction()
        }
    }

    private fun values(e: NewEvent): ContentValues {
        return ContentValues().apply {
            put("type", e.type)
            put("occurred_at", e.occurredAt)
            put("who", e.who)
            put("who_key", e.whoKey)
            put("app", e.app)
            put("title", e.title)
            put("body", e.body)
            put("data", e.data)
        }
    }

    private fun rows(sql: String, args: Array<Any?>): List<StoredEvent> {
        val out = ArrayList<StoredEvent>()
        // rawQuery takes its arguments as a vararg list: they must be spread, or the whole array becomes one argument.
        db.rawQuery(sql, *args).use { c ->
            while (c.moveToNext()) {
                fun s(i: Int) = if (c.isNull(i)) null else c.getString(i)
                out.add(StoredEvent(c.getLong(0), NewEvent(c.getString(1), c.getLong(2), s(3), s(4), s(5), s(6), s(7), s(8))))
            }
        }
        return out
    }

    private val cols = "seq, type, occurred_at, who, who_key, app, title, body, data"

    override fun after(seq: Long, limit: Int, types: Set<String>): List<StoredEvent> {
        if (types.isEmpty()) return emptyList()
        val marks = types.joinToString(",") { "?" }
        return rows("SELECT $cols FROM events WHERE seq > ? AND type IN ($marks) ORDER BY seq LIMIT ?", arrayOf<Any?>(seq, *types.toTypedArray(), limit))
    }

    override fun latestSeq(): Long =
        db.rawQuery("SELECT seq FROM sqlite_sequence WHERE name = 'events'").use { c -> if (c.moveToFirst()) c.getLong(0) else 0L }

    override fun search(q: String, limit: Int): List<StoredEvent> {
        if (q.isBlank()) return rows("SELECT $cols FROM events ORDER BY seq DESC LIMIT ?", arrayOf(limit))
        val like = like(q)
        return rows(
            "SELECT $cols FROM events WHERE who LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR app LIKE ? ESCAPE '\\' ORDER BY seq DESC LIMIT ?",
            arrayOf(like, like, like, like, limit),
        )
    }

    /** A LIKE pattern that matches `q` anywhere, with its own %, _ and \ taken literally. */
    private fun like(q: String) = "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    override fun query(types: Set<String>, from: Long, to: Long, who: String?, text: String?, limit: Int): List<StoredEvent> {
        if (types.isEmpty()) return emptyList()
        val sql = StringBuilder("SELECT $cols FROM events WHERE type IN (${types.joinToString(",") { "?" }}) AND occurred_at BETWEEN ? AND ?")
        val args = ArrayList<Any?>().apply { addAll(types); add(from); add(to) }
        if (!who.isNullOrBlank()) {
            sql.append(" AND who LIKE ? ESCAPE '\\'")
            args.add(like(who))
        }
        if (!text.isNullOrBlank()) {
            sql.append(" AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')")
            like(text).let { args.add(it); args.add(it) }
        }
        sql.append(" ORDER BY occurred_at DESC, seq DESC LIMIT ?")
        args.add(limit)
        return rows(sql.toString(), args.toTypedArray())
    }

    override fun delete(seqs: List<Long>): Int {
        if (seqs.isEmpty()) return 0
        return db.delete("events", "seq IN (${seqs.joinToString(",") { "?" }})", seqs.map { it.toString() }.toTypedArray())
    }

    override fun countsSince(time: Long): Map<String, Int> {
        val out = HashMap<String, Int>()
        db.rawQuery("SELECT type, COUNT(*) FROM events WHERE occurred_at >= ? GROUP BY type", time).use { c ->
            while (c.moveToNext()) out[c.getString(0)] = c.getInt(1)
        }
        return out
    }

    override fun addAudit(row: AuditRow) {
        db.insertOrThrow(
            "audit",
            null,
            ContentValues().apply {
                put("at", row.at)
                put("who", row.who)
                put("action", row.action)
                put("scope", row.scope)
                put("outcome", row.outcome)
                put("detail", row.detail)
            },
        )
        // The log keeps its last 2,000 lines.
        db.execSQL("DELETE FROM audit WHERE id <= (SELECT MAX(id) - 2000 FROM audit)")
    }

    override fun recentAudit(limit: Int): List<AuditRow> {
        val out = ArrayList<AuditRow>()
        db.rawQuery("SELECT at, who, action, scope, outcome, detail FROM audit ORDER BY id DESC LIMIT ?", limit).use { c ->
            while (c.moveToNext()) out.add(AuditRow(c.getLong(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getString(3), c.getString(4), if (c.isNull(5)) null else c.getString(5)))
        }
        return out
    }
}
