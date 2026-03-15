import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import { ChannelCursorRepository, CodexSessionBindingRepository, WatchLocationRepository } from "./repositories/config-repositories.js";
import {
  KnowledgeArtifactRepository,
  KnowledgeRecordRepository,
  KnowledgeSourceTextRepository,
  SourceLinkRepository
} from "./repositories/knowledge-repositories.js";
import {
  SanctionStateRepository,
  SoftBlockNoticeRepository,
  ViolationEventRepository
} from "./repositories/moderation-repositories.js";
import { OverrideSessionRepository } from "./repositories/override-repository.js";
import {
  AppRuntimeLockRepository,
  ChatChannelCounterRepository,
  ForumResearchPromptArtifactRepository,
  ForumResearchStateRepository,
  MessageProcessingRepository,
  RetryJobRepository,
  ScheduledDeliveryRepository
} from "./repositories/runtime-repositories.js";

export class SqliteStore {
  readonly db: Database.Database;
  readonly watchLocations: WatchLocationRepository;
  readonly channelCursors: ChannelCursorRepository;
  readonly codexSessions: CodexSessionBindingRepository;
  readonly knowledgeRecords: KnowledgeRecordRepository;
  readonly knowledgeArtifacts: KnowledgeArtifactRepository;
  readonly knowledgeSourceTexts: KnowledgeSourceTextRepository;
  readonly sourceLinks: SourceLinkRepository;
  readonly overrideSessions: OverrideSessionRepository;
  readonly violationEvents: ViolationEventRepository;
  readonly sanctionStates: SanctionStateRepository;
  readonly softBlockNotices: SoftBlockNoticeRepository;
  readonly messageProcessing: MessageProcessingRepository;
  readonly retryJobs: RetryJobRepository;
  readonly forumResearchStates: ForumResearchStateRepository;
  readonly forumResearchPromptArtifacts: ForumResearchPromptArtifactRepository;
  readonly runtimeLock: AppRuntimeLockRepository;
  readonly chatChannelCounters: ChatChannelCounterRepository;
  readonly scheduledDeliveries: ScheduledDeliveryRepository;

  constructor(dbPath: string, private readonly projectRoot = process.cwd()) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.watchLocations = new WatchLocationRepository(this.db);
    this.channelCursors = new ChannelCursorRepository(this.db);
    this.codexSessions = new CodexSessionBindingRepository(this.db);
    this.knowledgeRecords = new KnowledgeRecordRepository(this.db);
    this.knowledgeArtifacts = new KnowledgeArtifactRepository(this.db);
    this.knowledgeSourceTexts = new KnowledgeSourceTextRepository(this.db);
    this.sourceLinks = new SourceLinkRepository(this.db);
    this.overrideSessions = new OverrideSessionRepository(this.db);
    this.violationEvents = new ViolationEventRepository(this.db);
    this.sanctionStates = new SanctionStateRepository(this.db);
    this.softBlockNotices = new SoftBlockNoticeRepository(this.db);
    this.messageProcessing = new MessageProcessingRepository(this.db);
    this.retryJobs = new RetryJobRepository(this.db);
    this.forumResearchStates = new ForumResearchStateRepository(this.db);
    this.forumResearchPromptArtifacts = new ForumResearchPromptArtifactRepository(
      this.db
    );
    this.runtimeLock = new AppRuntimeLockRepository(this.db);
    this.chatChannelCounters = new ChatChannelCounterRepository(this.db);
    this.scheduledDeliveries = new ScheduledDeliveryRepository(this.db);
  }

  migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const migrationDir = resolve(this.projectRoot, "migrations");
    const files = readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const hasMigration = this.db.prepare(
      "SELECT 1 FROM schema_migrations WHERE name = ?"
    );
    const recordMigration = this.db.prepare(
      "INSERT INTO schema_migrations (name) VALUES (?)"
    );

    for (const file of files) {
      const exists = hasMigration.get(file);
      if (exists) {
        continue;
      }

      const sql = readFileSync(resolve(migrationDir, file), "utf8");
      const transaction = this.db.transaction(() => {
        this.db.exec(sql);
        recordMigration.run(file);
      });
      transaction();
    }
  }

  close(): void {
    this.db.close();
  }
}
