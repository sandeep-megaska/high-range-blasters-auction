// Optional Supabase (read-only for now). Works if you add env vars in Vercel.
// In Vercel → Project → Settings → Environment Variables:
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
// If you leave them empty, app still works fully offline (localStorage + CSV).

export const SUPABASE_URL = window?.ENV?.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON = window?.ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// We won’t import the SDK yet to keep things simple and zero-build.
// Later we can add <script src="https://esm.sh/@supabase/supabase-js"></script>
// and a small wrapper to fetch constraints/settings/team.

export async function loadConstraintsFromSupabase(team_slug){
  // Placeholder – return null to use DEFAULT_CONSTRAINTS
  // Later: call Supabase REST (PostgREST) or SDK to retrieve roster_constraints.
  return null;
}

export async function loadSettingsFromSupabase(team_slug){
  // Placeholder – return null to use local settings UI
  return null;
}

