<div align="center">

# Fluxo Inteligente

**Dados de circulação de visitantes transformados em insights para a gestão de shopping centers.**

[Demo online](https://flow-inteligence.vercel.app) · [Repositório](https://github.com/VitorAndrade5/fluxo-inteligente)

</div>

## Sobre o projeto

O Fluxo Inteligente é um MVP de analytics espacial para visualizar e compreender a circulação em um shopping. O painel combina eventos de passagem e dados de estacionamento para apoiar decisões operacionais e estratégicas.

O protótipo foi desenvolvido com foco no Capim Dourado Shopping, em Palmas–TO. Os dados exibidos em modo de demonstração podem ser simulados; para uso com dados reais, é necessário configurar a API, o banco de dados e as fontes de eventos.

## Funcionalidades

- Mapa de calor por zona e pavimento, com filtros de hotspots, zonas moderadas e coldspots.
- Métricas de passagens, ocupação, permanência e horários de pico.
- Análise de jornadas e tráfego entre setores.
- Painel de câmeras e eventos recebidos por visão computacional.
- Acompanhamento de vagas e ocupação do estacionamento.
- Worker opcional de visão computacional para processar câmeras, vídeos ou webcam e enviar eventos anônimos à API.

## Tecnologias

- **Frontend:** HTML, CSS e JavaScript.
- **Backend:** Python e FastAPI.
- **Visão computacional:** Python, OpenCV, Ultralytics YOLO e ByteTrack.
- **Banco de dados:** PostgreSQL quando `DATABASE_URL` está configurada; SQLite temporário em `/tmp` no modo de demonstração.
- **Deploy:** Vercel; o projeto também prevê integração com Neon para PostgreSQL.

## Estrutura do repositório

```text
.
├── backend/                 # API e scripts SQL
│   ├── app/                 # Aplicação FastAPI
│   └── sql/                 # Esquemas e dados iniciais
├── public/                  # Painel web servido como conteúdo estático
│   ├── data/                # Dados do shopping usados pelo painel
│   └── assets/              # Imagens e outros recursos
├── scripts/                 # Scripts auxiliares e de geração de dados
├── vision/                  # Worker e processamento de vídeo
│   ├── config.exemplo.json  # Exemplo de configuração das câmeras
│   └── requirements.txt     # Dependências do worker
├── index.py                 # Ponto de entrada da API na Vercel
└── ARQUITETURA (1) (1).md   # Visão geral da arquitetura proposta
```

## Executar o painel localmente

Para visualizar o frontend sem instalar dependências JavaScript, use Python 3 para servir a pasta `public`:

```bash
python -m http.server 5500 --directory public
```

Acesse [http://localhost:5500](http://localhost:5500). Para carregar dados da API, configure e execute também o backend; sem essa configuração, algumas áreas podem usar dados de demonstração ou ficar indisponíveis.

## API e deploy

A aplicação FastAPI está em `backend/app` e o arquivo `index.py` é o ponto de entrada usado pela configuração Python da Vercel. O dashboard está em `public/`.

Para publicar o projeto, importe o repositório na Vercel e configure as variáveis de ambiente conforme o ambiente:

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` | URL de conexão PostgreSQL. Sem ela, o modo de demonstração usa SQLite temporário em `/tmp`. |
| `FLUXO_INGEST_KEY` | Chave de autenticação dos eventos enviados pelo worker de visão. |

O worker envia eventos de passagem para `POST /api/events/batch` e eventos de estacionamento para `POST /api/parking/events`, usando o cabeçalho `X-API-Key`. Consulte a documentação e as configurações do ambiente antes de conectar câmeras ou publicar dados reais.

## Worker de visão computacional

O worker pode analisar câmeras RTSP, arquivos de vídeo ou webcam. Ele detecta pessoas ou veículos, acompanha as detecções e envia eventos à API. No fluxo documentado pelo projeto, os quadros não são enviados à API nem gravados pelo worker; apenas eventos são transmitidos.

1. Instale Python 3.10+ e as dependências do worker:

   ```bash
   python -m pip install -r vision/requirements.txt
   ```

2. Crie uma configuração local a partir do exemplo e ajuste as fontes, zonas e coordenadas para a sua câmera:

   ```bash
   cp vision/config.exemplo.json vision/config.json
   ```

3. Configure a URL da API e a chave de ingestão. Exemplo para PowerShell:

   ```powershell
   $env:FLUXO_INGEST_KEY = "sua-chave"
   python vision/worker.py --config vision/config.json --camera MNV-T-PRACA-CENTRAL --api https://seu-projeto.vercel.app
   ```

   Exemplo para Linux/macOS:

   ```bash
   export FLUXO_INGEST_KEY="sua-chave"
   python vision/worker.py --config vision/config.json --camera MNV-T-PRACA-CENTRAL --api https://seu-projeto.vercel.app
   ```

Para testar com um arquivo sem enviar eventos, use `--source arquivo.mp4 --dry-run --show`. O processamento de vídeo para demonstração está disponível em `vision/processar_video.py`; ele também requer `ffmpeg` instalado e acessível pelo `PATH`.

> **Privacidade:** use apenas fontes de vídeo autorizadas e avalie as obrigações legais e de proteção de dados aplicáveis. Os identificadores de rastreamento devem permanecer anônimos; não use imagens ou identificadores para identificar visitantes.

## Testes

Os testes do worker estão em `vision/tests`. Consulte o ambiente de desenvolvimento e as dependências do projeto para executá-los. A arquitetura proposta documenta testes de integração com `pytest`.

## Documentação adicional

- [Arquitetura do protótipo](./ARQUITETURA%20(1)%20(1).md)
- [Configuração de exemplo das câmeras](./vision/config.exemplo.json)
- [Planejamento inicial (PDF)](./Documenta%C3%A7%C3%A3o%20Planejamento%20inicial%20Fluxo%20inteligente.pdf)

## Status

Projeto em estágio de MVP/protótipo. A arquitetura e os dados de demonstração não substituem a configuração e validação em um ambiente de produção.
