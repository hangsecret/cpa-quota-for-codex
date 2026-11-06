using System;
using System.Diagnostics;
using System.Threading;

internal static class CodexLifetimeTests
{
    private static Process StartHost()
    {
        return Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--host") { UseShellExecute = false, CreateNoWindow = true });
    }
    private static CodexOwner Owner(Process process)
    {
        return new CodexOwner { Id = process.Id, StartedUtcTicks = process.StartTime.ToUniversalTime().Ticks };
    }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--host") >= 0) { Thread.Sleep(Timeout.Infinite); return 0; }
        using (var host = StartHost())
        using (var exited = new ManualResetEvent(false))
        {
            try
            {
                using (var lifetime = new CodexLifetime(Owner(host), delegate { exited.Set(); }))
                {
                    Check(!exited.WaitOne(300), "Running Codex must keep panel alive");
                    using (var discovery = StartHost()) { discovery.Kill(); discovery.WaitForExit(); }
                    Check(!exited.WaitOne(300), "Discovery process exit must not close panel");
                    Check(!exited.WaitOne(1500), "Subscription remains active as time passes");
                    host.Kill(); host.WaitForExit();
                    Check(exited.WaitOne(3000), "Codex process exit closes panel");
                }
            }
            finally { if (!host.HasExited) { host.Kill(); host.WaitForExit(); } }
        }
        using (var host = StartHost())
        using (var exited = new ManualResetEvent(false))
        {
            var lifetime = new CodexLifetime(Owner(host), delegate { exited.Set(); });
            lifetime.Dispose();
            host.Kill(); host.WaitForExit();
            Check(!exited.WaitOne(300), "Disposed subscription does not call window");
        }
        using (var host = StartHost())
        using (var exited = new ManualResetEvent(false))
        {
            try
            {
                var owner = Owner(host); owner.StartedUtcTicks++;
                using (var lifetime = new CodexLifetime(owner, delegate { exited.Set(); }))
                    Check(exited.WaitOne(300), "A reused process ID is not the original Codex");
            }
            finally { host.Kill(); host.WaitForExit(); }
        }
        Console.WriteLine("6 Codex lifecycle checks passed");
        return 0;
    }
}
