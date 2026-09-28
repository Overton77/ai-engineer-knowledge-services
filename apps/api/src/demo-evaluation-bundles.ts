import type { VettedBundleInput } from "@aiengineer/knowledge-application";

/**
 * Loads the allow-listed exploratory bundles for the demo evaluation route from the
 * repository fixtures. The test kit is a development dependency kept outside the API
 * bundle and imported only when the demo route runs, never when the API starts.
 */
export async function loadRepositoryDemoEvaluationBundles(): Promise<readonly VettedBundleInput[]> {
  const { loadEmbeddingBundles } = await import("@aiengineer/knowledge-testkit");
  return (await loadEmbeddingBundles()).map((item) => item.bundle);
}
