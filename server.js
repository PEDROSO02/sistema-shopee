// =====================
// IMPORTS
// =====================
const express = require("express");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");

const app = express();

// =====================
// CONFIGURAÇÕES
// =====================
app.use(cors());
app.use(bodyParser.json());

// SERVIR ARQUIVOS HTML E ESTÁTICOS
app.use(express.static(path.join(__dirname)));

// =====================
// ROTAS FRONTEND
// =====================

// Rota raiz (evita erro Cannot GET /)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

// Teste servidor
app.get("/test", (req, res) => {
    res.send("Servidor Node.js funcionando!");
});

// =====================
// GOOGLE SHEETS (AUTENTICAÇÃO COMPLETA PARA RENDER)
// =====================

let auth;

try {
    if (process.env.GOOGLE_PRIVATE_KEY) {

        console.log("Autenticação via Variáveis de Ambiente (Render)");

        const credentials = {
            type: "service_account",
            project_id: process.env.GOOGLE_PROJECT_ID,
            private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            client_id: process.env.GOOGLE_CLIENT_ID,
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
            client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL
        };

        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });

    } else {
        console.log("Autenticação via Arquivo Local (Desenvolvimento)");

        auth = new google.auth.GoogleAuth({
            keyFile: "service-account-key.json",
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
    }
} catch (error) {
    console.error("ERRO GRAVE NA AUTENTICAÇÃO DO GOOGLE SHEETS:", error.message);
}

const sheets = google.sheets({ version: "v4", auth });

// ID fixo da planilha
const SPREADSHEET_ID = "1pLFOyh7xDoPAAmKUq1aiqHK5yOTC4rE8cYTR6BaLY-o";

// =====================
// MÉTODO PARA VALIDAR TOKEN
// =====================
function verifyToken(req, res, next) {
    const token = req.headers["authorization"];
    if (!token) return res.status(403).send("Token necessário");

    jwt.verify(token, "secretkey", (err, decoded) => {
        if (err) return res.status(403).send("Token inválido");
        req.user = decoded;
        next();
    });
}

// =====================
// ROTAS DA API
// =====================

// LOGIN
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "usuarios!A:C",
        });

        const rows = response.data.values || [];

        const user = rows.find(
            (r) => r[0] === username && r[1] === password
        );

        if (!user) return res.status(401).send("Credenciais inválidas");

        const token = jwt.sign({ username, role: user[2] }, "secretkey");

        res.json({ token, role: user[2] });
    } catch (error) {
        console.error("ERRO LOGIN:", error);
        res.status(500).send("Erro ao acessar planilha. Verifique permissões.");
    }
});

// CADASTRAR PEDIDO
app.post("/pedidos", verifyToken, async (req, res) => {
    if (req.user.role !== "liberador")
        return res.status(403).send("Acesso negado");

    const { id_pedido, produtos } = req.body;

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: "pedidos!A:C",
            valueInputOption: "RAW",
            resource: {
                values: [
                    [id_pedido, "A embalar", JSON.stringify(produtos)]
                ],
            },
        });

        res.send("Pedido cadastrado com sucesso");
    } catch (error) {
        console.error("ERRO AO CADASTRAR PEDIDO:", error);
        res.status(500).send("Erro ao cadastrar pedido");
    }
});

// LISTAR PEDIDOS
app.get("/pedidos", verifyToken, async (req, res) => {
    if (req.user.role !== "embalador")
        return res.status(403).send("Acesso negado");

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "pedidos!A:C",
        });

        const rows = response.data.values || [];

        const pedidos = rows.map((row) => {
            let produtos = [];
            try {
                produtos = JSON.parse(row[2] || "[]");
            } catch {
                produtos = [];
            }
            return {
                id_pedido: row[0],
                status: row[1],
                produtos,
            };
        });

        res.json(pedidos);
    } catch (error) {
        console.error("ERRO LISTAR:", error);
        res.status(500).send("Erro ao listar pedidos");
    }
});

// ATUALIZAR STATUS
app.put("/pedidos/:id_pedido", verifyToken, async (req, res) => {
    if (req.user.role !== "embalador")
        return res.status(403).send("Acesso negado");

    const { status } = req.body;

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "pedidos!A:C",
        });

        const rows = response.data.values || [];
        const index = rows.findIndex((row) => row[0] === req.params.id_pedido);

        if (index === -1) return res.status(404).send("Pedido não encontrado");

        const statusCell = `pedidos!B${index + 1}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: statusCell,
            valueInputOption: "RAW",
            resource: { values: [[status]] },
        });

        res.send("Status atualizado com sucesso");
    } catch (error) {
        console.error("ERRO ATUALIZAR:", error);
        res.status(500).send("Erro ao atualizar status");
    }
});

// =====================
// INICIAR SERVIDOR
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`Servidor rodando na porta ${PORT}`)
);
