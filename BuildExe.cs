using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace GijoSolutionApp
{
    static class Program
    {
        private static HttpListener listener;
        private static string htmlContent = "<h1>GIJO Solution</h1>";
        private static int port = 8085;

        [STAThread]
        static void Main()
        {
            try
            {
                // 1. Try reading from embedded resource stream
                Assembly asm = Assembly.GetExecutingAssembly();
                string resourceName = null;
                foreach (string name in asm.GetManifestResourceNames())
                {
                    if (name.EndsWith("gijo_solution_portal.html") || name.EndsWith("index.html"))
                    {
                        resourceName = name;
                        break;
                    }
                }

                if (!string.IsNullOrEmpty(resourceName))
                {
                    using (Stream stream = asm.GetManifestResourceStream(resourceName))
                    {
                        if (stream != null)
                        {
                            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                            {
                                htmlContent = reader.ReadToEnd();
                            }
                        }
                    }
                }
                else
                {
                    // Fallback to local file if resource not embedded
                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    string htmlPath = Path.Combine(baseDir, "gijo_solution_portal.html");
                    if (!File.Exists(htmlPath)) htmlPath = Path.Combine(baseDir, "index.html");

                    if (File.Exists(htmlPath))
                    {
                        htmlContent = File.ReadAllText(htmlPath, Encoding.UTF8);
                    }
                }

                // Find open port starting at 8085
                for (int p = 8085; p < 8099; p++)
                {
                    try
                    {
                        HttpListener testListener = new HttpListener();
                        testListener.Prefixes.Add("http://localhost:" + p + "/");
                        testListener.Start();
                        testListener.Stop();
                        port = p;
                        break;
                    }
                    catch { }
                }

                // Start internal HTTP Server thread
                StartHttpServer();

                Thread.Sleep(200);

                // Open default browser automatically
                string targetUrl = "http://localhost:" + port + "/";
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetUrl,
                    UseShellExecute = true
                });

                // System Tray Icon
                NotifyIcon notifyIcon = new NotifyIcon();
                notifyIcon.Icon = System.Drawing.SystemIcons.Shield;
                notifyIcon.Text = "GIJO 취급 솔루션 포털 (실행 중)";
                notifyIcon.Visible = true;

                ContextMenu contextMenu = new ContextMenu();
                contextMenu.MenuItems.Add("🌐 포털 열기 (Open Portal)", (s, e) => {
                    Process.Start(new ProcessStartInfo { FileName = targetUrl, UseShellExecute = true });
                });
                contextMenu.MenuItems.Add("❌ 종료 (Exit App)", (s, e) => {
                    notifyIcon.Visible = false;
                    try { if (listener != null) listener.Stop(); } catch {}
                    Application.Exit();
                });
                notifyIcon.ContextMenu = contextMenu;

                notifyIcon.ShowBalloonTip(3000, "GIJO 취급 솔루션 포털", "포털이 성공적으로 실행되었습니다.", ToolTipIcon.Info);

                Application.Run();
            }
            catch (Exception ex)
            {
                MessageBox.Show("실행 오류: " + ex.Message, "GIJO Solution Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void StartHttpServer()
        {
            ThreadPool.QueueUserWorkItem((state) =>
            {
                try
                {
                    listener = new HttpListener();
                    listener.Prefixes.Add("http://localhost:" + port + "/");
                    listener.Start();

                    while (listener.IsListening)
                    {
                        HttpListenerContext context = listener.GetContext();
                        HttpListenerResponse response = context.Response;

                        byte[] buffer = Encoding.UTF8.GetBytes(htmlContent);
                        response.ContentType = "text/html; charset=utf-8";
                        response.ContentLength64 = buffer.Length;
                        response.OutputStream.Write(buffer, 0, buffer.Length);
                        response.OutputStream.Close();
                    }
                }
                catch { }
            });
        }
    }
}
