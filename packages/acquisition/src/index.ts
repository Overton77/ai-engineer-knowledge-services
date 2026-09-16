export type {
  AcquisitionAdapter,
  AcquisitionObservation,
  AcquisitionPlan,
  AcquisitionRequest,
  AcquisitionResult,
  AcquisitionTarget,
  AcquisitionVerification,
  AdmittedAcquisitionPlan,
  ManualUploadAttestation,
  PaperAcquisitionAdapter,
  PaperResolution,
  RepositoryAcquisitionAdapter,
  RepositoryManifest,
  SupportDecision,
  UploadAcquisitionAdapter,
} from "./types.js";
export {
  ExactHttpAcquisitionAdapter,
  assertSafeHttpUrl,
  buildPinnedRequestOptions,
  isForbiddenAddress,
  nodePinnedHttpTransport,
  resolveSafeHttpTarget,
  type DnsResolver,
  type HttpFetch,
  type HttpPolicy,
  type PinnedHttpTransport,
  type PinnedRequestOptions,
  type SafeHttpTarget,
} from "./http.js";
export { RoutedAcquisitionAdapter } from "./route.js";
export {
  BoundedManualUploadAdapter,
  FilesystemManualUploadSource,
  normalizeUploadPath,
  UPLOAD_ID_PATTERN,
  type FilesystemUploadSidecar,
  type ManualUploadPolicy,
  type ManualUploadRecord,
  type ManualUploadSource,
} from "./manual-upload.js";
export {
  observeSealedCapture,
  readSealedCapture,
  searchSealedCapture,
  type InspectionDimension,
  type InspectionFinding,
  type InspectionFindingStatus,
  type ObserveSealedCaptureInput,
  type ReadSealedCaptureInput,
  type SealedCaptureExcerpt,
  type SealedCaptureObservation,
  type SealedCaptureSearchHit,
  type SealedCaptureSearchResult,
  type SearchSealedCaptureInput,
} from "./inspect/index.js";
export { FixtureAcquisitionAdapter, type FakeAcquisitionFixture } from "./fakes.js";
export { FirecrawlAcquisitionAdapter } from "./firecrawl.js";
export { ImmutableRepositoryAcquisitionAdapter } from "./repository.js";
export {
  IdentityBoundPaperAcquisitionAdapter,
  normalizePaperIdentifier,
  type PaperProvider,
  type ResolvedPaper,
} from "./paper.js";
export { planPaperAsHttpRequest } from "./paper/plan-http.js";
