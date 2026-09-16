// ==========================================
// Supabase Connection Setup
// Facility Reservation and Approval System
// ==========================================

const SUPABASE_URL = "https://lnigzhylmpngbjmcmsni.supabase.co";
const SUPABASE_KEY = "sb_publishable_NTVdrHiRjITPVmKQuySn9Q_WlCW1DDG";

// Create the Supabase client (used by all other JS files)
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
