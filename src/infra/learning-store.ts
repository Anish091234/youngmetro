import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";

export interface ConversationEntry {
  id: string;
  timestamp: number;
  message: string;
  response: string;
  metadata: {
    device: "mac" | "iphone" | "ipad" | "surface";
    context?: string;
    userCorrection?: string;
    feedback?: number;
  };
}

export class LearningStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.env.HOME || "~", ".openclaw", "learning.db");
    // Ensure parent directory exists
    const parentDir = path.dirname(this.dbPath);
    // Use sync for constructor - acceptable for initialization
    try {
      require("fs").mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    } catch {
      // Directory may already exist
    }
    this.db = new Database(this.dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        device TEXT NOT NULL,
        context TEXT,
        user_correction TEXT,
        feedback INTEGER,
        created_at INTEGER DEFAULT (CAST(CURRENT_TIMESTAMP AS INTEGER))
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON conversations(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_device ON conversations(device);
      CREATE INDEX IF NOT EXISTS idx_feedback ON conversations(feedback);
    `);
  }

  logConversation(entry: ConversationEntry) {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, timestamp, message, response, device, context, user_correction, feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.timestamp,
      entry.message,
      entry.response,
      entry.metadata.device,
      entry.metadata.context || null,
      entry.metadata.userCorrection || null,
      entry.metadata.feedback || null,
    );
  }

  getConversationsSince(timestamp: number): ConversationEntry[] {
    const stmt = this.db.prepare(`
      SELECT id, timestamp, message, response, device, context, user_correction, feedback
      FROM conversations
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
    `);

    const rows = stmt.all(timestamp) as any[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      message: row.message,
      response: row.response,
      metadata: {
        device: row.device,
        context: row.context,
        userCorrection: row.user_correction,
        feedback: row.feedback,
      },
    }));
  }

  getAllConversations(limit = 1000): ConversationEntry[] {
    const stmt = this.db.prepare(`
      SELECT id, timestamp, message, response, device, context, user_correction, feedback
      FROM conversations
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      message: row.message,
      response: row.response,
      metadata: {
        device: row.device,
        context: row.context,
        userCorrection: row.user_correction,
        feedback: row.feedback,
      },
    }));
  }

  async exportForFineTuning(
    limit = 500,
  ): Promise<Array<{ messages: Array<{ role: string; content: string }> }>> {
    // Export high-quality conversations for fine-tuning
    // Prioritize: user corrections > high feedback > recent
    const stmt = this.db.prepare(`
      SELECT message, response
      FROM conversations
      WHERE (feedback >= 4 OR user_correction IS NOT NULL)
      ORDER BY
        CASE WHEN user_correction IS NOT NULL THEN 0 ELSE 1 END,
        feedback DESC,
        timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];

    return rows.map((row: any) => ({
      messages: [
        { role: "user", content: row.message },
        { role: "assistant", content: row.response },
      ],
    }));
  }

  getStatistics() {
    const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM conversations");
    const total = (totalStmt.get() as any)?.count || 0;

    const feedbackStmt = this.db.prepare(
      "SELECT AVG(feedback) as avg FROM conversations WHERE feedback IS NOT NULL",
    );
    const avgFeedback = (feedbackStmt.get() as any)?.avg || 0;

    const correctionStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM conversations WHERE user_correction IS NOT NULL",
    );
    const corrections = (correctionStmt.get() as any)?.count || 0;

    return {
      total,
      avgFeedback: Math.round(avgFeedback * 10) / 10,
      corrections,
      dbPath: this.dbPath,
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}
