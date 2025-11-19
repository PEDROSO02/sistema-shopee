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

// SERVIR ARQUIVOS HTML E OUTROS ARQUIVOS ESTÁTICOS DA PASTA ATUAL
app.use(express.static(path.join(__dirname)));

// =====================
// ROTAS DE SERVIÇO (Frontend)
// =====================

// ROTA RAÍZ (RESOLVE O CANNOT GET /)
// Envia o login.html ao acessar o endereço base do Render.
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ROTA DE TESTE (Para verificar a saúde do servidor)
app.get('/test', (req, res) => {
    res.send("O servidor Node.js está funcionando perfeitamente!");
});


// =====================
// GOOGLE SHEETS (AUTENTICAÇÃO COM VARIÁVEL DE AMBIENTE)
// =====================

let auth;

try {
    // 1. Tenta carregar as credenciais da variável de ambiente (Método seguro para Render)
    if (process.env.GOOGLE_CREDENTIALS) {
        // O conteúdo da variável deve ser o JSON completo da service-account-key
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        console.log("Autenticação via Variável de Ambiente (RENDER).");
    } else {
        // 2. Tenta carregar do arquivo local (Método para desenvolvimento local)
        auth = new google.auth.GoogleAuth({
            keyFile: "service-account-key.json",
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        console.log("Autenticação via Arquivo Local (DESENVOLVIMENTO).");
    }
} catch (error) {
    console.error("ERRO GRAVE NA AUTENTICAÇÃO DO GOOGLE SHEETS:", error.message);
}


const sheets = google.sheets({ version: "v4", auth });

// ID fixo da planilha
const SPREADSHEET_ID = "1pLFOyh7xDoPAAmKUq1aiqHK5yOTC4rE8cYTR6BaLY-o";

// =====================
// VERIFICAR TOKEN
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
    console.error("ERRO LOGIN (falha ao ler planilha):", error);
    // Este erro 500 agora deve ser causado por falha de permissão no Google Sheets
    res.status(500).send("Erro interno no login. Verifique as credenciais e permissões da planilha.");
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
        values: [[id_pedido, "A embalar", JSON.stringify(produtos)]],
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

    // O índice da coluna de status é 1 (A=0, B=1, C=2)
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
// Usa a porta fornecida pelo ambiente (Render) ou 3000 localmente.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Servidor rodando na porta ${PORT} e acessível em /`)
);