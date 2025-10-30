// assets/supabaseClient.js
// Create a single client using ENV defined in index.html (window.ENV.*)
const { createClient } = window.supabase;

if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  console.warn("Supabase ENV missing. Set window.ENV in index.html.");
}

export const sb = createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

// --- Clubs CRUD ---
export async function fetchClubs() {
  const { data, error } = await sb.from("clubs").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createClubDB({ slug, name, logo_url, starting_budget }) {
  const { error } = await sb.from("clubs").insert({
    slug, name, logo_url: logo_url || null,
    starting_budget: starting_budget ?? 15000,
    budget_left: starting_budget ?? 15000
  });
  if (error) throw error;
}

export async function updateClubDB({ id, name, logo_url, starting_budget }) {
  const patch = {};
  if (name != null) patch.name = name;
  if (logo_url !== undefined) patch.logo_url = logo_url || null;
  if (starting_budget != null) {
    patch.starting_budget = starting_budget;
    // keep budget_left if larger than new start? we won't touch here.
  }
  const { error } = await sb.from("clubs").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteClubDB(id) {
  const { error } = await sb.from("clubs").delete().eq("id", id);
  if (error) throw error;
}

export async function adjustBudgetDB({ club_id, delta }) {
  const { error } = await sb.rpc("adjust_budget", { p_club_id: club_id, p_delta: delta });
  if (error) throw error;
}

// --- Realtime subscription for clubs ---
export function onClubsRealtime(callback) {
  return sb
    .channel("clubs-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs" }, callback)
    .subscribe();
}

// Existing helpers you already used:
export async function loadSettingsFromSupabase(team) { return null; }
export async function loadConstraintsFromSupabase(team) { return []; }
