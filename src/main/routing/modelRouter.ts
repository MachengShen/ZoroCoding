import type { ProviderSnapshot } from "../../shared/domain";
import {
  classifyTask,
  type ModelSelection,
  type RouteDecision,
} from "../../shared/taskRouting";
import type { ModelRoutingConfig } from "../persistence/modelRoutingRepository";

export interface ResolvedRoute {
  decision: RouteDecision;
  selectionMode: "auto" | "manual";
  provider: ProviderSnapshot;
}

interface RoutingConfigReader {
  get(): ModelRoutingConfig | null;
}

interface ProviderSnapshotReader {
  getProviderSnapshot(providerId: string): ProviderSnapshot | null;
}

export class ModelRouter {
  constructor(
    private readonly routing: RoutingConfigReader,
    private readonly providers: ProviderSnapshotReader,
  ) {}

  resolve(input: {
    prompt: string;
    selection: ModelSelection;
  }): ResolvedRoute {
    const decision = classifyTask(input.prompt);
    if (input.selection.mode === "manual") {
      const provider = this.providers.getProviderSnapshot(
        input.selection.providerId,
      );
      if (provider === null) {
        throw new Error(
          `Manual provider ${input.selection.providerId} does not exist`,
        );
      }
      return { decision, selectionMode: "manual", provider };
    }

    const routing = this.routing.get();
    const providerId = decision.lane === "light"
      ? routing?.lightProviderId
      : routing?.premiumProviderId;
    if (providerId === null || providerId === undefined) {
      throw new Error(
        `No provider is configured for the ${decision.lane} lane`,
      );
    }
    const provider = this.providers.getProviderSnapshot(providerId);
    if (provider === null) {
      throw new Error(`Configured provider ${providerId} does not exist`);
    }
    return { decision, selectionMode: "auto", provider };
  }
}
