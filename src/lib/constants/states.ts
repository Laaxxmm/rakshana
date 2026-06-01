/**
 * Indian state & UT master with GST state codes.
 * Source: GST portal state code list (https://www.gst.gov.in/help/statecodes).
 *
 * Used by every address form and by GSTIN validation (first 2 digits of a
 * GSTIN must match the registered state code).
 */

export type IndianState = {
  /** Display name */
  name: string;
  /** GST state code, 2 digits, zero-padded */
  code: string;
  /** STATE vs UT (Union Territory) */
  kind: "STATE" | "UT";
};

export const INDIAN_STATES: readonly IndianState[] = [
  { code: "01", name: "Jammu & Kashmir",            kind: "UT"    },
  { code: "02", name: "Himachal Pradesh",           kind: "STATE" },
  { code: "03", name: "Punjab",                     kind: "STATE" },
  { code: "04", name: "Chandigarh",                 kind: "UT"    },
  { code: "05", name: "Uttarakhand",                kind: "STATE" },
  { code: "06", name: "Haryana",                    kind: "STATE" },
  { code: "07", name: "Delhi",                      kind: "UT"    },
  { code: "08", name: "Rajasthan",                  kind: "STATE" },
  { code: "09", name: "Uttar Pradesh",              kind: "STATE" },
  { code: "10", name: "Bihar",                      kind: "STATE" },
  { code: "11", name: "Sikkim",                     kind: "STATE" },
  { code: "12", name: "Arunachal Pradesh",          kind: "STATE" },
  { code: "13", name: "Nagaland",                   kind: "STATE" },
  { code: "14", name: "Manipur",                    kind: "STATE" },
  { code: "15", name: "Mizoram",                    kind: "STATE" },
  { code: "16", name: "Tripura",                    kind: "STATE" },
  { code: "17", name: "Meghalaya",                  kind: "STATE" },
  { code: "18", name: "Assam",                      kind: "STATE" },
  { code: "19", name: "West Bengal",                kind: "STATE" },
  { code: "20", name: "Jharkhand",                  kind: "STATE" },
  { code: "21", name: "Odisha",                     kind: "STATE" },
  { code: "22", name: "Chhattisgarh",               kind: "STATE" },
  { code: "23", name: "Madhya Pradesh",             kind: "STATE" },
  { code: "24", name: "Gujarat",                    kind: "STATE" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu", kind: "UT" },
  { code: "27", name: "Maharashtra",                kind: "STATE" },
  { code: "28", name: "Andhra Pradesh (Old)",       kind: "STATE" },
  { code: "29", name: "Karnataka",                  kind: "STATE" },
  { code: "30", name: "Goa",                        kind: "STATE" },
  { code: "31", name: "Lakshadweep",                kind: "UT"    },
  { code: "32", name: "Kerala",                     kind: "STATE" },
  { code: "33", name: "Tamil Nadu",                 kind: "STATE" },
  { code: "34", name: "Puducherry",                 kind: "UT"    },
  { code: "35", name: "Andaman & Nicobar Islands",  kind: "UT"    },
  { code: "36", name: "Telangana",                  kind: "STATE" },
  { code: "37", name: "Andhra Pradesh",             kind: "STATE" },
  { code: "38", name: "Ladakh",                     kind: "UT"    },
] as const;

const NAME_TO_CODE = new Map(INDIAN_STATES.map((s) => [s.name, s.code]));
const CODE_TO_STATE = new Map(INDIAN_STATES.map((s) => [s.code, s]));

export function stateCodeForName(name: string): string | undefined {
  return NAME_TO_CODE.get(name);
}

export function stateForCode(code: string): IndianState | undefined {
  return CODE_TO_STATE.get(code);
}

export const STATE_NAMES: readonly string[] = INDIAN_STATES.map((s) => s.name);
