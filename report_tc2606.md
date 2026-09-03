# 📋 Relatório Completo — Teamcenter 2606

**Data de Geração:** 2026-08-26
**Servidor:** SRV26-TC1-DEV
**Ambiente:** DEV (Desenvolvimento)

---

## 1. Informações Gerais

| Propriedade | Valor |
|-------------|-------|
| **Versão** | 2606.0.0.2026052800 |
| **Versão Completa** | 2606:2026052800 |
| **Data do Build** | Quinta-feira, 28 de Maio de 2026, 21:17:19 IST |
| **Aplicação** | tceng (Teamcenter Engineering) |
| **Diretório de Instalação** | E:\PLM\Teamcenter2606 |
| **Diretório de Dados** | E:\PLM\tcdata2606 |
| **Diretório de Origem** | E:\InstaladoresPLM2606\TC_2606\tc2606_wntx64\tc2606_wntx64 |
| **Usuário de Instalação** | siemens.aldo |
| **Idioma** | ENGLISH |
| **Upgrade De** | Teamcenter 2512 (E:\PLM\Teamcenter2512) |
| **Servidor** | SRV26-TC1-DEV |
| **Engine TEM** | 2008.0.0 |

---

## 2. Configuração do Banco de Dados

| Configuração | Valor |
|-------------|-------|
| **Tipo de Banco** | Microsoft SQL Server (MSSQL) |
| **Host do Banco** | 172.18.2.51 |
| **Porta** | 1433 |
| **Instância** | MSSQLSERVERDEV (v15) |
| **Database TC** | tc_DEV_2026 |
| **Database Cluster** | TcClusterDB_DEV_2026 |
| **Usuário DB** | infodba |
| **Autenticação Windows** | false |
| **Collation** | Latin1_General_BIN |
| **Caminho Dados SQL** | Y:\MSSQL15.MSSQLSERVERDEV\MSSQL\Data |

---

## 3. Configuração de Infraestrutura

### 3.1 TC Server

| Configuração | Valor |
|-------------|-------|
| **Endpoint** | http://localhost:7001/tc/ |
| **Protocolo** | HTTP |
| **FSC Address** | http://SRV26-TC1-DEV:4544/ |
| **HTTP Endpoint** | http://localhost:8080/tc |

### 3.2 TCCS (Teamcenter Common Services)

| Configuração | Valor |
|-------------|-------|
| **Max Idle Time** | 240 min |
| **Max Connections/Host** | 8 |
| **Total Max Connections** | 10 |
| **Connection Timeout** | 90000 ms |
| **Socket Timeout** | 90000 ms |
| **Kerberos** | Desabilitado |

### 3.3 FMS/FSC (File Management System)

| Configuração | Valor |
|-------------|-------|
| **Parent FSC** | http://SRV26-TC1-DEV:4544/ |
| **Assignment Mode** | clientmap |

### 3.4 Search Engine (Solr)

| Configuração | Valor |
|-------------|-------|
| **Versão Solr** | 9.6.0 |
| **Admin User** | solr_admin |
| **Node** | SRV26-TC1-DEV:30066 |
| **Local Node Port** | 30077 |
| **Schema** | TC_SOLR_SCHEMA.xml |

### 3.5 Microservices

| Serviço | Descrição |
|---------|----------|
| **eureka_server** | Service Discovery (Eureka) |
| **gateway** | API Gateway |
| **file_repo** | File Repository Service |
| **darsi** | DARSI Service |
| **tcgql** | Teamcenter GraphQL |
| **req_export_service** | Requirements Export |
| **req_import_service** | Requirements Import |
| **service_dispatcher** | Service Dispatcher |
| **microserviceparameterstore** | Parameter Store |

### 3.6 Outras Configurações

| Configuração | Valor |
|-------------|-------|
| **NX Home** | E:\PLM\NX_2406 |
| **License Server** | 28000@lic01 |
| **Process Manager** | Instalado (ProcessManagerService.exe) |
| **Pool Manager** | Instalado |
| **DOTNET Micro Proxy** | Instalado |
| **JWT Config Tool** | Instalado |

---

## 4. Features e Módulos Instalados (168 total)

### 4.1 Infraestrutura Core

| # | Feature |
|---|--------|
| 1 | Microsoft Visual C++ Runtimes |
| 2 | Microsoft Edge WebView2 Runtime |
| 3 | FOSS Repository |
| 4 | Microservices Manager |
| 5 | Microservices Framework |
| 6 | FMS Server Cache |
| 7 | Server Manager |
| 8 | Indexer |
| 9 | Search Engine |
| 10 | Dispatcher Server |
| 11 | Client Communication System (Core) |
| 12 | Client Configuration |

### 4.2 Teamcenter Foundation

| # | Feature |
|---|--------|
| 13 | Teamcenter Foundation |
| 14 | Business Modeler IDE |
| 15 | Business Modeler Templates |
| 16 | Business Modeler IDE 2-tier |
| 17 | Business Modeler IDE 4-tier |
| 18 | Teamcenter Rich Client 4-tier |
| 19 | Teamcenter Management Console |
| 20 | Preference Management |
| 21 | UI Builder |
| 22 | XRT Editor |
| 23 | Sample Files |

### 4.3 Active Workspace

| # | Feature |
|---|--------|
| 24 | Active Workspace Client |
| 25 | Active Workspace Gateway |
| 26 | Active Workspace/Runtime Server |
| 27 | Active Workspace/Data Model |
| 28 | Search for Active Workspace Client |
| 29 | Active Workspace Visualization 2D Viewer |
| 30 | Viewer Administration |
| 31 | Viewer Tool Client Utilities |
| 32 | Viewer Snapshot Tool |
| 33 | Viewer Refset and Leaf Structure |
| 34 | Active Content |
| 35 | Digital Thread Navigation |
| 36 | 3D Visualization |
| 37 | Geometric Tool |
| 38 | PMI Tool |
| 39 | Relations Component |
| 40 | Rich Text Editor for Active Workspace Client |
| 41 | Markup for Active Workspace Client |
| 42 | Tcme AW Icons |

### 4.4 Serviços Core

| # | Feature |
|---|--------|
| 43 | Teamcenter Task Manager Service |
| 44 | Action Manager Service |
| 45 | Teamcenter Read Expression Manager Service |
| 46 | Subscription Manager Service |
| 47 | Teamcenter Revision Configuration Accelerator Service |
| 48 | Audit/Runtime Server |
| 49 | Audit/Data Model |
| 50 | Audit Client |

### 4.5 Gestão de Documentos e Conteúdo

| # | Feature |
|---|--------|
| 51 | Document Management for Active Workspace Client |
| 52 | Active Workspace Document Management/Runtime Server |
| 53 | Active Workspace Document Management/Data Model |
| 54 | Content Management Client |
| 55 | Active Content Structure/Runtime Server |
| 56 | Active Content Structure/Active Content Structure |
| 57 | TC XML Import and Export/Data Model |
| 58 | TC XML Import and Export/Runtime Server |

### 4.6 Workflow e Processos

| # | Feature |
|---|--------|
| 59 | Workflow |
| 60 | Workflow for Active Workspace |
| 61 | Build Conditions/Runtime Server |
| 62 | Build Conditions/Data Model |
| 63 | Support for Concurrent Modeling |

### 4.7 Gestão de Mudanças

| # | Feature |
|---|--------|
| 64 | Change Management/Data Model |
| 65 | Change Management 4th Generation Interface/Data Model |
| 66 | Change Management 4th Generation Interface/Runtime Server |
| 67 | Change Management 4th Generation Interface/Change Management 4th Generation Interface For Rich Client |
| 68 | Change and Schedule Management Interface/Runtime Server |
| 69 | Change and Schedule Management Interface/Change and Schedule Management Interface |
| 70 | Change and Schedule Management Interface/Data Model |
| 71 | Kanban Interface for Active Workspace |

### 4.8 Schedule e Projeto

| # | Feature |
|---|--------|
| 72 | Schedule Manager |
| 73 | Schedule Manager for Active Workspace/Runtime Server |
| 74 | Schedule Manager for Active Workspace/Data Model |
| 75 | Gantt Interface for Active Workspace |
| 76 | Project Assignment |

### 4.9 Classificação

| # | Feature |
|---|--------|
| 77 | Classification Interface/Data Model |
| 78 | Classification Interface/Runtime Server |
| 79 | Classification Server/Classification Server/Data Model |
| 80 | Classification Server/Runtime Server |
| 81 | Classification AI |
| 82 | NX Part Family Classification Integration |

### 4.10 Integrações CAD

| # | Feature |
|---|--------|
| 83 | NX Foundation/Runtime Server |
| 84 | NX Foundation/Data Model |
| 85 | NX Fixed Plane Additive Manufacturing Integration/Data Model |
| 86 | Autodesk AutoCAD Foundation/AutoCAD Foundation |
| 87 | Integration for SolidWorks/Teamcenter Integration for SolidWorks |
| 88 | Integration for SolidWorks/Runtime Server |
| 89 | Integration for Creo/Runtime Server |
| 90 | Integration for Creo/Integration for Pro/ENGINEERING |
| 91 | Integration for CATIA/Integration for CATIA |
| 92 | Integration for CATIA/Runtime Server |
| 93 | Teamcenter Integration for Solid Edge/Solid Edge Embedded Client Overlay |
| 94 | Teamcenter Integration for Solid Edge/Runtime Server |
| 95 | EQCustomization/Runtime Server |
| 96 | EQCustomization/Data Model |
| 97 | PlantSimulationIntegration/Data Model |

### 4.11 Active Integration (AIG/T4S)

| # | Feature |
|---|--------|
| 98 | Active Integration for Active Workspace |
| 99 | Active Integration/Data Model |
| 100 | Active Integration/Runtime Server |
| 101 | Teamcenter Gateway for SAP Business Suite and S/4HANA/Integration for Rich Client |
| 102 | Teamcenter Gateway for SAP Business Suite and S/4HANA/Teamcenter Gateway For SAP |
| 103 | Gateway for modeling/Runtime Server |
| 104 | Gateway for modeling/Gateway for modeling/Data Model |

### 4.12 Manufatura

| # | Feature |
|---|--------|
| 105 | Manufacturing Foundation/Runtime Server |
| 106 | Manufacturing Foundation/Data Model |
| 107 | Teamcenter Manufacturing Access/TCMAccess for Rich Client |
| 108 | Teamcenter Manufacturing Access/Data Model |
| 109 | Teamcenter Manufacturing Access/Runtime Server |
| 110 | Easy Plan - mbc0mfgbvrcore client |
| 111 | Core services for manufacturing on BVR/Data Model |
| 112 | Core services for manufacturing on BVR/Runtime Server |
| 113 | Core services for manufacturing on BVR/Easy Plan Interoperability for Rich Client |
| 114 | EasyPlan Active Workspace Infrastructure/Data Model |
| 115 | EasyPlan Active Workspace Infrastructure/Runtime Server |

### 4.13 Requirements Management

| # | Feature |
|---|--------|
| 116 | Data Discovery Services Client |
| 117 | Data Discovery Services/Data Model |
| 118 | Data Discovery Services/Runtime Server |

### 4.14 Reporting

| # | Feature |
|---|--------|
| 119 | Reporting Client |
| 120 | Reporting for Active Workspace/Runtime Server |
| 121 | Reporting for Active Workspace/Data Model |

### 4.15 Branching e Versionamento

| # | Feature |
|---|--------|
| 122 | Branch Data Organization/Runtime Server |
| 123 | Branch Data Organization/Data Model |
| 124 | Branching and Versioning Foundation/Runtime Server |
| 125 | Branching and Versioning Foundation/Branching and Versioning Foundation/Data Model |

### 4.16 Visão de Engenharia e Simulação

| # | Feature |
|---|--------|
| 126 | Engineering Views/Runtime Server |
| 127 | Engineering Views/Engineering Views Data Model |
| 128 | Test Manager/Runtime Server |
| 129 | Test Manager/Data Model |
| 130 | Test Manager/Test Manager for Rich Client |
| 131 | Customization for Process Simulate Integration/Data Model |

### 4.17 APS (Advanced PLM Services)

| # | Feature |
|---|--------|
| 132 | Advanced PLM Services core Template/Advanced PLM Services Core For Rich Client |
| 133 | Advanced PLM Services core Template/Runtime Server |
| 134 | Advanced PLM Services core Template/Advanced PLM Services core Template/Data Model |
| 135 | APS Configured Search Framework/Data Model |
| 136 | APS Configured Search Framework/Runtime Server |
| 137 | Advanced PLM Services for Applications/Data Model |
| 138 | Advanced PLM Services for Applications/Advanced PLM Services for Applications For Rich Client |
| 139 | Advanced PLM Services for Applications/Runtime Server |

### 4.18 Outros Módulos

| # | Feature |
|---|--------|
| 140 | Active Collaboration Client |
| 141 | Active Collaboration/Runtime Server |
| 142 | Active Collaboration/Data Model |
| 143 | Active Collaboration for Retail Solution [DEPRECATED]/Runtime Server |
| 144 | Active Collaboration for Retail Solution [DEPRECATED]/Data Model |
| 145 | Security |
| 146 | MFE Common Client |
| 147 | PS Component |
| 148 | Task Management for Active Workspace |
| 149 | Subscription/Runtime Server |
| 150 | Subscription/Data Model |
| 151 | Active Workspace Assistant/Runtime Server |
| 152 | Active Workspace Assistant/Data Model |
| 153 | Authorization Active Workspace/Runtime Server |
| 154 | Authorization Active Workspace/Data Model |
| 155 | Active Architect Core/Data Model |
| 156 | Active Admin Core/Data Model |
| 157 | Common Integration Framework/Runtime Server |
| 158 | Common Integration Framework/Data Model |
| 159 | Logical Object |
| 160 | Translation Service Database Module/Data Model |
| 161 | bruning/Runtime Server |
| 162 | bruning/Data Model |
| 163 | Usage Foundation for Active Workspace/Data Model |
| 164 | Visualization Extension for Active Workspace/Data Model |
| 165 | Visualization Extension for Active Workspace/Runtime Server |
| 166 | Relationship Viewer |
| 167 | Realization |
| 168 | Rich Text Editor for Active Workspace Client |

---

## 5. Short Names dos Módulos

| Short Name | Descrição |
|------------|----------|
| Calendar Management | Gestão de Calendários |
| Change Management | Gestão de Mudanças |
| Document Management Client | Gestão de Documentos |
| Gantt Interface | Interface Gantt |
| Kanban Interface | Interface Kanban |
| Markup | Anotações |
| Preference Management | Gestão de Preferências |
| Reporting | Relatórios |
| Requirements Management | Gestão de Requisitos |
| Rich Text Editor | Editor de Texto Rico |
| Schedule Manager | Gestão de Agenda |
| Search | Busca |
| TCME AW Icons | Ícones TCME AW |
| Task Management | Gestão de Tarefas |
| Workflow | Fluxo de Trabalho |

---

## 6. Template Names (Identificadores Internos)

| Template Name | Módulo |
|---------------|--------|
| awa0awassistant | Active Workspace Assistant |
| ac0activecollaboration | Active Collaboration |
| adm1admconsolecore | Admin Console Core |
| aps0apscore | Advanced PLM Services Core |
| arm1awreqmgmtse | AW Requirements Management |
| aut0authorizationaws | Authorization AWS |
| aws2 | Active Workspace Server 2 |
| bcs0buildconditions | Build Conditions |
| bdo0branchdataorganization | Branch Data Organization |
| bhv1branchingandversioning | Branching and Versioning |
| bhv0branchfoundation | Branch Foundation |
| Cm1cmaws | Change Management AWS |
| classification | Classification |
| cls1classificationaw | Classification AW |
| csi1cmsmawinterface | CMS AW Interface |
| dds0datadiscovery | Data Discovery |
| eqcustomization | EQ Customization |
| epa0easyplanawinfra | EasyPlan AW Infrastructure |
| evm1viewmgmtaw | View Management AW |
| evm0viewmgmt | View Management |
| fgc0cm4g | Change Management 4G |
| ics1icsaw | Integration Content Structure |
| integration4catia | CATIA Integration |
| ipem | iPEM (Creo Integration) |
| lo1logicalobject | Logical Object |
| mbc0mfgbvrcore | Manufacturing BVR Core |
| mfg0foundation | Manufacturing Foundation |
| mrm0mfgresourcemgraw | Manufacturing Resource Manager |
| nx0tcin | NX TC Integration |
| partition | Partition |
| prf1prefmgmt | Preference Management |
| ps | Process Simulate |
| pm0partmanufacturing | Part Manufacturing |
| rb0reportingaw | Reporting AW |
| realization | Realization |
| relationshipviewer | Relationship Viewer |
| req_export_service | Requirements Export Service |
| req_import_service | Requirements Import Service |
| s1clsocial | Social/Collaboration |
| saw1projectmanagementaw | Project Management AW |
| srh0apsconfiguredsearch | APS Configured Search |
| t4s | T4S (SAP Integration) |
| tca0tcmaccess | TC Manufacturing Access |
| tm0tsm | Test Manager |
| tie0aw | Teamcenter Integration Engine |
| um0usermanagement | User Management |
| classification_ai | Classification AI |

---

## 7. Estrutura de Diretórios

### 7.1 Teamcenter2606 (Install)

```
E:\PLM\Teamcenter2606\
├── aws2/                    # Active Workspace Server 2
├── bin/                     # Executables & utilities (500+ arquivos)
│   ├── bmide/               # BMIDE tools
│   ├── csharpooscust/       # C# OOTB customization
│   └── ...
├── bmide/                   # Business Modeler IDE
├── classification/          # Classification module
├── data/                    # Data definitions & templates
├── dotnet_microproxy/       # .NET micro proxy
├── file_repo/               # File repository
├── foss_repository/         # FOS repository
├── fsc/                     # File Storage Client
│   ├── FSC_Teamcenter_homologacao.xml
│   └── fscadmin.properties
├── include/                 # C/C++ include files
├── install/                 # Installation artifacts (80+ feature dirs)
├── janus/                   # Janus integration
├── jwt_config_tool/         # JWT configuration tool
├── l10n_cots/               # Localization
├── lang/                    # Language files
├── lib/                     # Libraries
├── logs/                    # Log files
├── mgmt_console/            # Management console
├── microservices/           # Microservices
│   ├── darsi/
│   ├── eureka_server/
│   ├── file_repo/
│   ├── gateway/
│   ├── microserviceparameterstore/
│   ├── req_export_service/
│   ├── req_import_service/
│   ├── tcgql/
│   └── service_dispatcher/
├── midtierservers/          # Middle tier
├── perl/                    # Perl scripts
├── pool_manager/            # Pool manager
├── portal/                  # Rich Client (Teamcenter.exe)
├── process_manager/         # Process Manager
├── sample/                  # Sample data
├── signer_config/           # Code signing config
├── solr-9.6.0/              # Apache Solr 9.6.0
├── tccs/                    # TC Client Server
│   ├── fcc.xml
│   ├── tccs.xml
│   ├── tcserver.xml
│   └── sessionagent.properties
├── TcFTSIndexer/            # Full-text search indexer
├── web/                     # Web tier (CCI)
└── web_tier/                # Web tier (AWC)
```

### 7.2 tcdata2606 (Data)

```
E:\PLM\tcdata2606\
├── .tc_resource_def
├── admin_console_data/
├── classification/
├── crf/
├── csv2tcxml/
├── elm/
├── ftsi/                    # FTS index data
├── gpfiles/
├── grdv_transform_files/
├── gs_info/
├── imv0metaverse/
├── install/
├── ippe/
├── json/
├── log_172.18.2.51_tc_DEV_2026/
├── manufacturing_templates/
├── preference/              # Preferences
└── ... (hundreds of XML configs, templates)
```

---

## 8. Histórico de Upgrades

O ambiente foi submetido a múltiplas tentativas de upgrade/instalação entre 20-26 de Agosto de 2026:

| Data | Log File |
|------|----------|
| 20/08/2026 | install_TC_2608201755_290.log |
| 22/08/2026 | install_TC_2608221728_40.log |
| 22/08/2026 | install_TC_2608221744_38.log |
| 23/08/2026 | install_TC_2608230858_55.log |
| 26/08/2026 | install_TC_2608261326_53.log |
| 26/08/2026 | install_TC_2608261328_38.log |

Checkpoints de upgrade registrados: rac4t, datamodel, web, rac, microservice, micro_group, indexer, rtserver.

---

## 9. Integrações CAD Instaladas

| Integração | Versão | Status |
|-----------|--------|--------|
| NX Integration | 2606 | Instalado |
| SolidWorks Integration (SWIM) | 2606 | Instalado |
| Creo Integration (iPEM) | 2606 | Instalado |
| CATIA Integration | 2606 | Instalado |
| Solid Edge (SEEC) | 2026 | Instalado |
| AutoCAD Foundation | 2606 | Instalado |
| Plant Simulation | 2606 | Instalado |
| Process Simulate | 2606 | Instalado |

---

## 10. Resumo Executivo

- **Ambiente:** Teamcenter 2606 em upgrade a partir do TC 2512
- **Banco:** SQL Server 2019 (MSSQL) em 172.18.2.51
- **Total de Features:** 168 módulos instalados
- **Integrações CAD:** 8 sistemas (NX, SolidWorks, Creo, CATIA, Solid Edge, AutoCAD, Plant Sim, Process Sim)
- **Microservices:** 9 serviços (Eureka, Gateway, File Repo, DARSI, GraphQL, Req Export/Import, Dispatcher, Parameter Store)
- **Busca:** Apache Solr 9.6.0
- **AW Client:** Active Workspace Client completo com visualização 2D/3D
- **SAP:** Teamcenter Gateway for SAP Business Suite e S/4HANA (T4S)
- **Classificação:** Interface + Server + AI
- **Manufatura:** Foundation + BVR + EasyPlan + Resource Manager
- **Status:** Ambiente de desenvolvimento (DEV) com múltiplas tentativas de instalação em Agosto/2026

---

*Relatório gerado automaticamente via tc-bridge MCP tunnel*
