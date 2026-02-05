import cron from "node-cron";
import { LearningStore } from "./learning-store.js";

export interface FineTuningConfig {
  enabled: boolean;
  autoSchedule: boolean; // Enable cron-based scheduling (2am daily)
  minConversationsToTrain: number; // Don't fine-tune if fewer conversations
}

export class FineTuningScheduler {
  private store: LearningStore;
  private config: FineTuningConfig;
  private scheduledTask?: cron.ScheduledTask;
  private onSleepingSignalCallback?: () => Promise<void>;

  constructor(store: LearningStore, config?: Partial<FineTuningConfig>) {
    this.store = store;
    this.config = {
      enabled: true,
      autoSchedule: true,
      minConversationsToTrain: 10,
      ...config,
    };
  }

  registerSleepingSignal(callback: () => Promise<void>) {
    this.onSleepingSignalCallback = callback;
    return {
      onSleepingSignal: () => this.triggerFineTuning(),
    };
  }

  async triggerFineTuning() {
    if (!this.config.enabled) {
      console.log("[FineTuning] Fine-tuning is disabled");
      return;
    }

    console.log("[FineTuning] Starting fine-tuning pipeline...");

    try {
      // Get training data
      const trainingData = await this.store.exportForFineTuning();

      if (trainingData.length < this.config.minConversationsToTrain) {
        console.log(
          `[FineTuning] Not enough conversations yet (${trainingData.length}/${this.config.minConversationsToTrain})`,
        );
        return;
      }

      console.log(`[FineTuning] Exporting ${trainingData.length} high-quality conversations...`);

      // Save training data to file for later use
      const timestamp = new Date().toISOString().split("T")[0];
      const trainingFile = `${process.env.HOME}/.openclaw/learning/finetune-${timestamp}.jsonl`;

      // Create directory
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(path.dirname(trainingFile), { recursive: true });

      // Write training data in JSONL format
      const jsonl = trainingData.map((d) => JSON.stringify(d)).join("\n");
      await fs.writeFile(trainingFile, jsonl);

      console.log(`[FineTuning] Training data exported to ${trainingFile}`);
      console.log(
        `[FineTuning] Fine-tuning data ready. You can use this with: ollama create <model-name> --modelfile <modelfile>`,
      );
      console.log(
        "[FineTuning] Note: Full fine-tuning implementation requires model-specific tooling",
      );

      // Call callback if registered
      if (this.onSleepingSignalCallback) {
        await this.onSleepingSignalCallback();
      }

      const stats = this.store.getStatistics();
      console.log(
        `[FineTuning] Current stats: ${stats.total} conversations, avg feedback ${stats.avgFeedback}/5`,
      );
    } catch (error) {
      console.error("[FineTuning] Error during fine-tuning:", error);
    }
  }

  setupSchedule() {
    if (!this.config.enabled || !this.config.autoSchedule) {
      return;
    }

    // Schedule: 2am every day
    const pattern = "0 2 * * *";
    console.log("[FineTuning] Setting up automatic daily fine-tuning at 2am");

    this.scheduledTask = cron.schedule(pattern, async () => {
      console.log("[FineTuning] Running scheduled fine-tuning");
      await this.triggerFineTuning();
    });
  }

  stopSchedule() {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      console.log("[FineTuning] Scheduled fine-tuning stopped");
    }
  }
}
