/**
 * The screen's two modes — run history and the import composer — owned by one
 * shell so both stay mounted and a half-built selection survives the round
 * trip. Re-exported from the Charity Commission screen: the behaviour is
 * identical, only the panels differ.
 */
export {
  ConsoleContext,
  ImportConsole,
  NewImportButton,
  useConsole,
} from "../charity-commission/import-console";
