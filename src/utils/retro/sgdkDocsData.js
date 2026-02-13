/**
 * Dados de Documentação do SGDK para o Help Viewer
 * Estilo Windows Help / Delphi
 */

export const sgdkHelpTopics = [
  {
    id: 'intro',
    title: 'Introdução ao SGDK',
    icon: 'fas fa-info-circle',
    content: `
      <h1>Bem-vindo ao SGDK</h1>
      <p>O <b>Sega Genesis Development Kit (SGDK)</b> é um conjunto completo de ferramentas e bibliotecas para criar jogos para o Sega Mega Drive / Genesis usando a linguagem C.</p>
      <h3>Principais Recursos:</h3>
      <ul>
        <li>Compilador GCC otimizado para o 68000.</li>
        <li>Biblioteca de alta performance para VDP (Gráficos).</li>
        <li>Suporte para múltiplos drivers de som (XGM, SGDK, etc).</li>
        <li>Gerenciamento automático de recursos (.res).</li>
      </ul>
      <p>Este sistema de ajuda foi projetado para facilitar a consulta rápida de funções e conceitos.</p>
    `
  },
  {
    id: 'graphics',
    title: 'Gráficos e VDP',
    icon: 'fas fa-tv',
    children: [
      {
        id: 'vdp_init',
        title: 'Inicialização do VDP',
        function: 'VDP_init',
        content: `
          <h1>VDP_init()</h1>
          <p>Inicializa o processador de vídeo (VDP) com as configurações padrão.</p>
          <pre>void VDP_init();</pre>
          <p>Esta função deve ser chamada logo no início do seu <code>main()</code>.</p>
        `
      },
      {
        id: 'vdp_planes',
        title: 'Planos de Fundo',
        content: `
          <h1>Planos de Fundo (Planes)</h1>
          <p>O Mega Drive possui dois planos de fundo principais:</p>
          <ul>
            <li><b>BG_A</b>: Plano frontal.</li>
            <li><b>BG_B</b>: Plano traseiro.</li>
            <li><b>WINDOW</b>: Plano estático (geralmente usado para HUD).</li>
          </ul>
          <p>Use a função <code>VDP_drawText()</code> para escrever rapidamente em qualquer plano.</p>
        `
      }
    ]
  },
  {
    id: 'sprites',
    title: 'Sprites (Engine)',
    icon: 'fas fa-ghost',
    children: [
      {
        id: 'spr_init',
        title: 'Inicialização de Sprites',
        function: 'SPR_init',
        content: `
          <h1>SPR_init()</h1>
          <p>Inicializa o motor de sprites do SGDK.</p>
          <pre>void SPR_init();</pre>
          <p>Você deve chamar esta função se pretender usar sprites no seu jogo.</p>
        `
      },
      {
        id: 'spr_add',
        title: 'Adicionando Sprites',
        function: 'SPR_addSprite',
        content: `
          <h1>SPR_addSprite()</h1>
          <p>Cria um novo sprite na tela com base em uma definição de recurso.</p>
          <pre>Sprite* SPR_addSprite(const SpriteDefinition* spritedef, s16 x, s16 y, u16 attribute);</pre>
        `
      }
    ]
  },
  {
    id: 'sound',
    title: 'Áudio e Som',
    icon: 'fas fa-volume-up',
    children: [
      {
        id: 'xgm_play',
        title: 'Reprodução XGM',
        function: 'XGM_startPlay',
        content: `
          <h1>Driver XGM</h1>
          <p>O driver XGM permite tocar músicas com até 4 canais PCM e suporte a loops.</p>
          <pre>void XGM_startPlay(const u8* music);</pre>
        `
      }
    ]
  },
  {
    id: 'input',
    title: 'Entrada (Controles)',
    icon: 'fas fa-gamepad',
    children: [
      {
        id: 'joy_read',
        title: 'Lendo Controles',
        function: 'JOY_readJoypad',
        content: `
          <h1>JOY_readJoypad()</h1>
          <p>Lê o estado atual de um controle (JOY_1 ou JOY_2).</p>
          <pre>u16 JOY_readJoypad(u16 port);</pre>
          <p>Retorna um bitmask com os botões pressionados.</p>
        `
      }
    ]
  }
]
