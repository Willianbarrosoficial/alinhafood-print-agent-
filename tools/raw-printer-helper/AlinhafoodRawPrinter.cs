using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Uso: AlinhafoodRawPrinter.exe <printerName> <filePath>");
            return 2;
        }

        string printerName = args[0]?.Trim() ?? string.Empty;
        string filePath = args[1]?.Trim() ?? string.Empty;

        if (printerName.Length == 0)
        {
            Console.Error.WriteLine("Nome da impressora vazio.");
            return 2;
        }

        if (!File.Exists(filePath))
        {
            Console.Error.WriteLine("Arquivo de impressao nao encontrado: " + filePath);
            return 2;
        }

        byte[] payload = File.ReadAllBytes(filePath);
        if (payload.Length == 0)
        {
            Console.Error.WriteLine("Arquivo de impressao vazio.");
            return 2;
        }

        try
        {
            RawPrinter.Send(printerName, payload);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }
}

internal static class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOC_INFO_1
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void Send(string printerName, byte[] payload)
    {
        IntPtr printerHandle = IntPtr.Zero;
        bool pageStarted = false;
        bool docStarted = false;

        try
        {
            if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero))
            {
                throw CreateWin32Error("Nao foi possivel abrir a impressora", printerName);
            }

            DOC_INFO_1 docInfo = new DOC_INFO_1
            {
                pDocName = "Alinhafood Print Agent",
                pOutputFile = null,
                pDataType = "RAW",
            };

            if (StartDocPrinter(printerHandle, 1, ref docInfo) == 0)
            {
                throw CreateWin32Error("Nao foi possivel iniciar o job RAW", printerName);
            }

            docStarted = true;

            if (!StartPagePrinter(printerHandle))
            {
                throw CreateWin32Error("Nao foi possivel iniciar a pagina RAW", printerName);
            }

            pageStarted = true;

            if (!WritePrinter(printerHandle, payload, payload.Length, out int written))
            {
                throw CreateWin32Error("Falha ao enviar bytes RAW para a impressora", printerName);
            }

            if (written != payload.Length)
            {
                throw new InvalidOperationException(
                    $"Impressao RAW incompleta em \"{printerName}\": {written}/{payload.Length} bytes enviados."
                );
            }
        }
        finally
        {
            if (pageStarted)
            {
                EndPagePrinter(printerHandle);
            }

            if (docStarted)
            {
                EndDocPrinter(printerHandle);
            }

            if (printerHandle != IntPtr.Zero)
            {
                ClosePrinter(printerHandle);
            }
        }
    }

    private static Exception CreateWin32Error(string message, string printerName)
    {
        int code = Marshal.GetLastWin32Error();
        string detail = new System.ComponentModel.Win32Exception(code).Message;
        return new InvalidOperationException($"{message} \"{printerName}\" (Win32 {code}: {detail}).");
    }
}
