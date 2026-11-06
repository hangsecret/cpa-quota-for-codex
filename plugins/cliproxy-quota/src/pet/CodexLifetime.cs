using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal sealed class CodexOwner
{
    internal int Id;
    internal long StartedUtcTicks;
}

internal sealed class CodexLifetime : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Reserved1, Peb, Reserved2, Reserved3, ProcessId, ParentId;
    }
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr handle, int kind, out ProcessInformation information, int size, out int returned);

    private Process host;
    private readonly Action onExit;
    private readonly object gate = new object();
    private bool disposed;
    private bool notified;
    private Timer discovery;

    internal CodexLifetime(CodexOwner owner, Action exited)
    {
        onExit = exited;
        if (owner == null)
        {
            discovery = new Timer(Discover, null, Timeout.Infinite, Timeout.Infinite);
            discovery.Change(0, 2000);
        }
        else Bind(owner);
    }

    private void Discover(object state)
    {
        var owner = Resolve();
        if (owner == null) return;
        lock (gate)
        {
            if (disposed || host != null) return;
            discovery.Dispose();
            Bind(owner);
        }
    }

    private void Bind(CodexOwner owner)
    {
        try
        {
            host = Process.GetProcessById(owner.Id);
            if (host.StartTime.ToUniversalTime().Ticks != owner.StartedUtcTicks) { NotifyExit(); return; }
            host.Exited += HostExited;
            host.EnableRaisingEvents = true;
            if (host.HasExited) NotifyExit();
        }
        catch (ArgumentException) { NotifyExit(); }
        catch (InvalidOperationException) { NotifyExit(); }
    }

    private void HostExited(object sender, EventArgs args) { NotifyExit(); }

    private void NotifyExit()
    {
        lock (gate)
        {
            if (disposed || notified) return;
            notified = true;
        }
        onExit();
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
        }
        if (host != null) { host.Exited -= HostExited; host.Dispose(); }
        if (discovery != null) discovery.Dispose();
    }

    private static bool IsCodex(Process process)
    {
        string file = process.MainModule.FileName;
        return file.IndexOf("\\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0
            && file.EndsWith("\\app\\ChatGPT.exe", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsCodexProcess(int id)
    {
        try { using (var process = Process.GetProcessById(id)) return IsCodex(process); }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }

    private static CodexOwner Identity(Process process)
    {
        return new CodexOwner { Id = process.Id, StartedUtcTicks = process.StartTime.ToUniversalTime().Ticks };
    }

    private static int Parent(Process process)
    {
        ProcessInformation information;
        int returned;
        int status = NtQueryInformationProcess(process.Handle, 0, out information, Marshal.SizeOf(typeof(ProcessInformation)), out returned);
        return status == 0 ? information.ParentId.ToInt32() : 0;
    }

    internal static CodexOwner Resolve()
    {
        int id = Process.GetCurrentProcess().Id;
        for (int depth = 0; id > 0 && depth < 24; depth++)
        {
            try
            {
                using (var process = Process.GetProcessById(id))
                {
                    if (IsCodex(process)) return Identity(process);
                    int parent = Parent(process);
                    if (parent == id) break;
                    id = parent;
                }
            }
            catch (ArgumentException) { break; }
            catch (InvalidOperationException) { break; }
            catch (System.ComponentModel.Win32Exception) { break; }
        }
        // A desktop shortcut has Explorer ancestry. Attach to the running Codex window.
        foreach (var process in Process.GetProcessesByName("ChatGPT"))
        {
            using (process)
            {
                try
                {
                    if (IsCodex(process) && process.MainWindowHandle != IntPtr.Zero) return Identity(process);
                }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }
        }
        return null;
    }
}
