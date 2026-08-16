// Supabase Configuration
const SUPABASE_URL = "https://zyeuqsaekwepdcukfktz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5ZXVxc2Fla3dlcGRjdWtma3R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODA2NDgsImV4cCI6MjEwMjQ1NjY0OH0.tZfq0ugsxJdhDLH3eyk3q60OfqJXb_vvSt4oUyVtPFk";

// Initialize Supabase Client
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
