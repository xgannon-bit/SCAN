import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep evaluation builds from replacing files used by an active desktop server.
  distDir: process.env.SCAN_IMAGE_REGISTRATION_R02_BUILD === "1" ? ".next-image-registration-r02" : process.env.SCAN_IMAGE_REGISTRATION_BUILD === "1" ? ".next-image-registration" : process.env.SCAN_IMAGE_FIRST_BUILD === "1" ? ".next-image-first" : process.env.SCAN_BOARD_EVIDENCE_R02_BUILD === "1" ? ".next-board-evidence-r02" : process.env.SCAN_BOARD_EVIDENCE_BUILD === "1" ? ".next-board-evidence" : process.env.SCAN_FULL_BOARD_BUILD === "1" ? ".next-full-board" : process.env.SCAN_PROCESSING_BUILD === "1" ? ".next-visual-processing" : process.env.SCAN_VISUAL_BUILD === "1" ? ".next-visual-rebuild" : process.env.SCAN_DIAGNOSIS_BUILD === "1" ? ".next-independent-diagnosis" : process.env.SCAN_REPAIR_BUILD === "1" ? ".next-placement-repair" : process.env.SCAN_DEVELOPMENT_BUILD === "1" ? ".next-development" : process.env.SCAN_EVALUATION_BUILD === "1" ? ".next-evaluation" : ".next",
};

export default nextConfig;
