# Arquitetura — Fluxo Inteligente (protótipo)

> Grupo 21 Arcanine · HACKARUN — mapa mental da arquitetura proposta.

```mermaid
mindmap
  root((Fluxo Inteligente))
    Coleta de Dados
      Câmeras de segurança já existentes
      Visão Computacional via API - Monuv
      MVP: simulador de eventos de passagem
    Backend - FastAPI Python
      Recebe eventos de passagem
      Zonas de calor: hotspots e coldspots
      Correlação de trajetos Setor A → Setor B
      API REST
        POST /eventos
        GET /relatorios
    Banco de Dados SQL
      Setores da planta
      Câmeras
      Eventos de passagem
        visitante anônimo
        origem e destino
        data e hora
    Frontend - HTML CSS JS
      Tela 1: Autenticação
      Tela 2: Mapa de Calor
      Tela 3: Jornada e Métricas
      Protótipo no Figma
      Deploy na Vercel
    Testes de Integração - pytest
      1 POST simula um visitante
      2 Confere o dado no banco
      3 GET confirma o retorno ao dashboard
    Roadmap
      Vagas de estacionamento em tempo real
      Segurança patrimonial: fluxos anormais
```

## Como as partes se conectam

**Câmeras / Monuv** → enviam eventos → **Backend FastAPI** → grava e consulta → **Banco SQL**
**Frontend** → consome a API → mostra **Mapa de Calor** e **Jornada** para o gestor do shopping
