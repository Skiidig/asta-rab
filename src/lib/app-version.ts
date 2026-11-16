import packageJson from "../../package.json";

/**
 * Satu sumber versi aplikasi: `package.json`.
 * Footer dan dokumen rilis membaca nilai ini agar tidak ada versi ganda.
 */
export const APP_VERSION = packageJson.version;
