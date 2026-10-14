import type { ArchiveReview, ArchiveSelection } from '../lib/scan/archive-types';
import type { ImageRegistrationState, PixelImage } from '../lib/scan/image-registration';
export function sha(bytes: Buffer): string;
export function authoredPng(width?: number, height?: number, features?: number[][]): Buffer;
export function authoredImageFixture(tag?: string): { bytes: Buffer; selection: ArchiveSelection; image: PixelImage; raster: Buffer };
export function authoredMapping(fixture?: ReturnType<typeof authoredImageFixture>): Promise<{ fixture: ReturnType<typeof authoredImageFixture>; review: ArchiveReview; state: ImageRegistrationState }>;

export function authoredProcessingMapping(): Promise<Awaited<ReturnType<typeof authoredMapping>> & { diagnosis: ReturnType<typeof import("./native-diagnosis-fixture.mjs").authoredDiagnosis> }>;
