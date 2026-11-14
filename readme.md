# Fluxo Inteligente

Plataforma de **Spatial Analytics** para transformar dados de circulação em informações úteis à gestão de shopping centers. O MVP é voltado ao **Capim Dourado Shopping**, em Palmas–TO, e apresenta os dados em um painel interativo por pavimento, zona e período.

> O projeto está em desenvolvimento. A integração com câmeras/Monuv é prevista; o sistema também conta com dados simulados para demonstração.

## O que o painel oferece

- **Mapa de calor:** visualização da concentração de visitantes na planta, com filtros de período e pavimento.
- **Análise por zona:** passagens, ocupação, permanência e identificação de hotspots e coldspots.
- **Jornadas:** trajetos mais comuns, caminhos até uma zona e fluxo entre setores.
- **Métricas:** resumo do período, pico de circulação e ranking de zonas.
- **Acesso da equipe:** autenticação para consultar as áreas protegidas do painel e da API; também há modo de demonstração na interface.

Os limites usados para classificar as zonas no painel são **hotspot a partir de 80%** e **coldspot até 25%** da capacidade indicada.

## Tecnologias e arquitetura

- **Interface:** HTML, CSS e JavaScript.
- **API:** Python com FastAPI.
- **Persistência:** SQL; configuração compatível com SQLite para desenvolvimento e PostgreSQL por URL de conexão.
- **Hospedagem prevista:** Vercel, com suporte a banco PostgreSQL gerenciado.
- **Dados:** eventos de circulação podem ser enviados à API; há simulador para gerar dados de demonstração.

Em alto nível, eventos de circulação são persistidos no banco e consultados pela API; o painel consome esses dados para montar o mapa e as análises. A integração com a plataforma Monuv é uma possibilidade de coleta prevista, não deve ser entendida como uma integração ativa garantida neste MVP.

## API

A API FastAPI disponibiliza documentação interativa em `/docs` quando estiver em execução. Entre os recursos implementados estão:

- `POST /api/auth/login` e `GET /api/auth/me` — autenticação;
- `GET /api/health` — estado da API e do banco;
- `GET /api/floors`, `GET /api/sectors` e `GET /api/zones` — catálogo da planta;
- `POST /api/events` e `POST /api/events/batch` — ingestão de eventos;
- `GET /api/heatmap` e `GET /api/heatmap/timeline` — mapa de calor e série temporal;
- `GET /api/metrics/*` — resumo, permanência e datas disponíveis;
- `GET /api/journeys/*` e `GET /api/visitors/{track_id}/journey` — análises de jornadas;
- `POST /api/simulate` — geração administrativa de dados simulados.

As rotas que consultam informações do painel requerem autenticação. A ingestão aceita a chave de API configurada ou um token de usuário, conforme a rota.

## Configuração

A aplicação lê configuração por variáveis de ambiente. As principais são:

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` ou `POSTGRES_URL` | URL do banco PostgreSQL; sem uma delas, a configuração usa SQLite local. |
| `FLUXO_SECRET_KEY` | Chave para assinatura dos tokens de autenticação. |
| `FLUXO_INGEST_KEY` | Chave para autenticar integrações de ingestão. |
| `FLUXO_ADMIN_EMAIL` | E-mail da conta administrativa inicial. |
| `FLUXO_ADMIN_PASSWORD` | Senha da conta administrativa inicial. |
| `FLUXO_TOKEN_TTL_HOURS` | Validade do token em horas (padrão: 12). |
| `FLUXO_AUTO_SIMULATE` | Ativa a simulação automática de dados (padrão: ativada). |
| `FLUXO_SIMULATED_VISITORS` | Quantidade de visitantes usada pelo simulador (padrão: 3000). |
| `FLUXO_CORS_ORIGINS` | Origens permitidas pelo CORS, separadas por vírgula. |
| `CRON_SECRET` | Segredo usado pelo endpoint de simulação agendada. |

**Segurança:** os valores padrão de desenvolvimento não devem ser usados em produção. Configure chaves e senha fortes antes de conectar a aplicação a um banco PostgreSQL. Evite publicar segredos no repositório.

## Estrutura do repositório

O repositório contém os arquivos da interface (`index.html`, `styles.css` e `script.js`), módulos Python da API e da persistência, além de scripts SQL de esquema, consultas e dados iniciais. `index.py` é o adaptador de entrada serverless para a Vercel. Consulte também [`ARQUITETURA (1) (1).md`](./ARQUITETURA%20(1)%20(1).md) para o diagrama conceitual.

> A disposição dos arquivos de backend e frontend pode variar conforme o ambiente de execução/deploy; confira a configuração de execução correspondente antes de iniciar localmente ou publicar uma nova versão.

## Contexto

O produto busca apoiar decisões de operação e gestão comercial a partir de padrões agregados de circulação. O acompanhamento de trajetos deve respeitar as regras de privacidade e proteção de dados aplicáveis; o projeto não deve ser usado para identificar visitantes.
