# Planejamento Inicial - Fluxo Inteligente
Grupo 21 Arcanine
## 1. Documentação inicial do projeto
O **Fluxo Inteligente** é uma plataforma de *Spatial Analytics* desenvolvida para otimizar a gestão comercial, operacional e estratégica de shopping centers. O sistema transforma dados de movimentação capturados por câmeras em inteligência de negócios.

O foco central da solução:
* **Mapeamento de Jornada (Tracking de Trajeto):** Identificar o percurso de consumo dos visitantes. O sistema analisa padrões comportamentais, como por exemplo: quais corredores um cliente percorre antes de ir ao cinema? Qual o trajeto mais comum de quem consome no setor de vestuário?
* **Zonas de Calor (Heatmaps):** Exibir a concentração de pessoas em diferentes ambientes e horários, identificando *hotspots* (áreas superlotadas) e *coldspots* (áreas de baixa circulação).

**Visão de Futuro (Roadmap):** A arquitetura do projeto foi pensada para escalar. Futuramente, a mesma inteligência visual será aplicada para mapear vagas de estacionamento, permitindo que os motoristas visualizem vagas liberadas em tempo real (evitando rodar sem rumo), além de atuar em conjunto com a equipe de segurança patrimonial para identificação de fluxos anormais.

## 2. Proposta e estrutura inicial das telas
A interface gerencial foi desenhada com foco em usabilidade, garantindo que os gestores do shopping acessem insights complexos de forma visual e intuitiva.

**Link para o Protótipo:** [Acessar telas no Figma](https://www.figma.com/design/xtOsYpudG0uO7d44zuQ03G/Flow-Intelligence-%E2%80%94-Produto---Arquitetura?node-id=0-1&t=vMNRauIOsor8CH3n-1)
 
* **Tela 1 - Autenticação:** Acesso seguro e restrito à equipe administrativa.
* **Tela 2 - Dashboard (Mapa de Calor):** Exibe a planta baixa do shopping com a sobreposição de um *heatmap* dinâmico, atualizado de acordo com o horário selecionado.
* **Tela 3 - Análise de Jornada e Métricas:** Painel com gráficos detalhando os percursos mais comuns e o volume de tráfego cruzado entre diferentes setores (ex: Praça de Alimentação vs. Lojas de Departamento).

## 3. Linguagem de programação escolhida
* **Python:** Para a construção da lógica do servidor (backend) e processamento das regras de jornada.
* **JavaScript, HTML5 e CSS3:** Para a construção da interface do usuário (frontend), manipulação dinâmica da planta do shopping e consumo dos dados.
* **SQL:** Linguagem de consulta estruturada utilizada para modelagem e extração do histórico de trajetos no banco de dados.

## 4. Arquitetura proposta
A solução adota uma arquitetura Cliente-Servidor (Client-Server) baseada em uma API:
* **Coleta de Dados:** O sistema é desenhado para integrar via API com plataformas de Visão Computacional (como a Monuv), utilizando as câmeras de segurança já existentes no shopping como sensores de fluxo. Para este MVP, o backend simulará esses eventos de passagem.
* **Processamento (Backend):** Recebe os eventos, calcula as áreas de concentração, processa a correlação de trajetos (ex: Setor A -> Setor B) e persiste as informações estruturadas.
* **Visualização (Frontend):** Atua de forma isolada, consumindo os *endpoints* da API para renderizar o dashboard e os relatórios em tempo real no navegador do gestor.

## 5. Plataforma e tecnologias adotadas
* **Backend & API:** `FastAPI` (Python) — Adotado pela sua alta velocidade de execução, suporte a processos assíncronos e facilidade na criação de rotas REST.
* **Frontend:** `HTML`, `CSS` e `JavaScript` — Adotado para manter o projeto leve e ágil durante o hackathon, facilitando a sobreposição de elementos gráficos na imagem do mapa.
* **Banco de Dados:** Banco relacional (`SQL`) — Ideal para armazenar um alto volume de eventos temporais e realizar consultas complexas de cruzamento de trajetos.
* **Design e Prototipação:** `Figma` — Para estruturação visual de telas e fluxos.
* **Deploy (Hospedagem):** `Vercel` para o frontend web, garantindo integração contínua.

## 6. Descrição de como a tecnologia/prática sorteada será incorporada à solução
A prática sorteada foi **Testes de integração (Testes de um fluxo completo, de ponta a ponta)**.

No nosso sistema de *Spatial Analytics*, a confiabilidade dos dados exibidos no painel é crítica. Para garantir isso, a prática será incorporada no backend utilizando o framework de testes automatizados `pytest` do Python. O teste de integração irá validar o ciclo de vida completo de um registro de movimentação, executando o seguinte fluxo de ponta a ponta:

1. **Simulação (Input):** O script de teste dispara uma requisição HTTP `POST` simulando o rastreio de um visitante (ex: "Visitante passou do corredor de roupas para a praça de alimentação às 12h30").
2. **Persistência:** O teste verifica se a API processou a regra de negócio e inseriu o dado de forma íntegra nas tabelas do banco de dados relacional.
3. **Validação de Retorno (Output):** Imediatamente após a inserção, o teste realiza uma chamada `GET` no endpoint de relatórios. O objetivo é atestar que o dado recém-capturado é retornado corretamente, provando que o frontend em JavaScript receberá a informação exata necessária para atualizar o mapa de calor e a análise de trajeto sem quebras no fluxo.
