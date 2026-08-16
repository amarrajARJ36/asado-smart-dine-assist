// Supabase Configuration
const SUPABASE_URL = "https://zyeuqsaekwepdcukfktz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZXVxc2Fla3dlcGRjdWtma3R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODA2NDgsImV4cCI6MjEwMjQ1NjY0OH0.tZfq0ugsxJdhDLH3eyk3q60OfqJXb_vvSt4oUyVtPFk";

// Initialize Supabase Client
// The CDN script already declares a global 'supabase' object, so we use it directly
if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
  window.sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("Supabase client initialized successfully");
} else {
  console.error("Supabase SDK not loaded. Check the CDN script tag.");
}
