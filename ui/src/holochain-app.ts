import '@webcomponents/scoped-custom-element-registry';

import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  AgentPubKey,
  AppSignal,
  AppWebsocket,
  EntryHash,
  InstalledAppInfo,
  InstalledCell,
} from '@holochain/client';
import { contextProvider } from '@lit-labs/context';
import '@material/mwc-circular-progress';

import { get } from 'svelte/store';
import { appWebsocketContext, appInfoContext, burnerServiceContext } from './contexts';
import { serializeHash, deserializeHash } from '@holochain-open-dev/utils';
import { AgentPubKeyB64, ChannelMessageInput, MessageInput, Username } from './types/chat';
import { ChatScreen } from './components/chat-screen';
// import { BurnerStore } from './burner-store';
import { BurnerService } from './burner-service';
import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import { BurnerServiceContext } from './components/service-context';
import { TaskSubscriber } from 'lit-svelte-stores';

@customElement('holochain-app')
export class HolochainApp extends LitElement {
  @state() loading = false;
  @state() entryHash: EntryHash | undefined;

  @contextProvider({ context: appWebsocketContext })
  @property({ type: Object })
  appWebsocket!: AppWebsocket;

  @contextProvider({ context: appInfoContext })
  @property({ type: Object })
  appInfo!: InstalledAppInfo;

  @contextProvider({ context: burnerServiceContext })
  @property({ type: Object })
  service!: BurnerService;

  @query("chat-screen")
  chatScreen!: ChatScreen;

  @query("input#join-channel")
  joinChannelInput!: HTMLInputElement;

  @query("input#enter-name")
  enterNameInput!: HTMLInputElement;

  @query("#test-signal-text-input")
  textInputField!: HTMLInputElement;

  @query("#test-recipient-input")
  recipientInputField!: HTMLInputElement;

  @query("#channel-secret-input")
  channelSecretInputField!: HTMLInputElement;

  // @state()
  // allMyChannels: string[] = [];

  @state()
  myAgentPubKey!: string;

  activeChannel = new TaskSubscriber(
    this,
    () => this.service.getChannel(),
    () => [this.service]
  );

  username = new TaskSubscriber(
    this,
    () => this.service.getUsername(),
    () => [this.service]
  );

  @state()
  activeChannelMembers: Record<AgentPubKeyB64, Username> = {};

  // service!: BurnerService;
  async dispatchTestSignal() {
    // get the input from the input text field
    const input = this.textInputField.value;
    // copied from boiulerplate
    const cellData = this.appInfo.cell_data.find((c: InstalledCell) => c.role_id === 'burner_chat')!;
    await this.appWebsocket.callZome({
      cap_secret: null,
      cell_id: cellData.cell_id,
      zome_name: 'chat',
      fn_name: 'signal_test',
      payload: input,
      provenance: cellData.cell_id[1]
    });
  }

  // async sendRemoteSignal() {
  //   const msgText = this.textInputField.value;
  //   const recipient = this.recipientInputField.value;
  //   const msgInput: MessageInput = {
  //     signalType: "Message",
  //     payload: msgText,
  //     senderName: "sender",
  //     recipients: [deserializeHash(recipient)],
  //     channel: this.activeChannel.value!,
  //   }

  //   const cellData = this.appInfo.cell_data.find((c: InstalledCell) => c.role_id === 'burner_chat')!;
  //   await this.appWebsocket.callZome({
  //     cap_secret: null,
  //     cell_id: cellData.cell_id,
  //     zome_name: 'chat',
  //     fn_name: 'send_msg',
  //     payload: msgInput,
  //     provenance: cellData.cell_id[1]
  //   });
  // }

  async burnChannel() {
    const channelToBurn = this.activeChannel.value;
    if (!channelToBurn) {
      return;
    }
    // const allMyChannelsFiltered = this.allMyChannels.filter(channel => channel !== channelToBurn);
    const burnChannelInput: ChannelMessageInput = {
      signalType: "BurnChannel",
      channel: channelToBurn,
      username: this.username.value!,
    }
    await this.service.burnChannel(burnChannelInput);
    // this.allMyChannels = allMyChannelsFiltered;
    this.service.setChannel(undefined);
  }

  signalCallback = async (signal: AppSignal) => {
    console.log("HOLOCHAIN-APP: RECEIVED SIGNAL: ", signal.data.payload);
    // filter only current room
    const signalPayload = signal.data.payload;
    const signalType = signal.data.payload.signalType;
    if (signalType === "EmojiCannon") {
      // propagate and let chat-screen decide if emoji cannon should be fired
      this.chatScreen.receiveEmojiCannonSignal(signal);

    } else if (signalType === "Message" && signalPayload.channel === this.activeChannel.value) {
      // propagate only when in active room
      this.chatScreen.receiveMessageSignal(signal);

    } else if (signalType === "JoinChannel" && signalPayload.channel === this.activeChannel.value) {
      console.log("signal of joining arrived");
      // @TODO 1. check if join channel is === activeChannel
      const allChatMembers = await this.service.getChannelMembers(signalPayload.channel);
      const activeChannelMembers: Record<AgentPubKeyB64, Username> = {};
      allChatMembers.forEach(([pubKey, username]) => {
        activeChannelMembers[serializeHash(pubKey)] = username;
      })
      this.activeChannelMembers = activeChannelMembers;

    } else if (signalType === "BurnChannel" && signalPayload.channel === this.activeChannel.value) {
      this.chatScreen.receiveBurnSignal(signal);
    }
  }


  async firstUpdated() {

    this.appWebsocket = await AppWebsocket.connect(
      `ws://localhost:${process.env.HC_PORT}`,
      undefined, // timeout
    );

    this.appInfo = await this.appWebsocket.appInfo({
      installed_app_id: 'burner-chat',
    });

    const cellData = this.appInfo.cell_data.find((c: InstalledCell) => c.role_id === 'burner_chat')!;
    this.myAgentPubKey = serializeHash(cellData.cell_id[1]);

    const cell = this.appInfo.cell_data.find(c => c.role_id === 'burner_chat');
    const client = new HolochainClient(this.appWebsocket);
    const cellClient = new CellClient(client, cell!);
    cellClient.addSignalHandler(this.signalCallback);

    this.service = new BurnerService(cellClient);
    console.log("SETTING SERVICE INSIDE HOLOCHAIN");
    console.log(this.service);

    this.loading = false;
  }

  async start() {
    // get name and set as username
    let username = this.enterNameInput.value
    this.service.setUsername(username);
    // get channel secret and join channel
    const channelToJoin = this.joinChannelInput.value;
    const channelMessageInput: ChannelMessageInput = {
      signalType: "JoinChannel",
      channel: channelToJoin,
      username: this.username.value!,
    }
    await this.joinChannel(channelMessageInput);
  }

  async joinChannel(input: ChannelMessageInput): Promise<void> {
    // if (this.allMyChannels.includes(input.channel)) {
    //   return;
    // }
    await this.service.joinChannel(input);
    const channelMembers = await this.service.getChannelMembers(input.channel);
    console.log(channelMembers);
    this.activeChannelMembers = {};
    channelMembers.forEach(([pubKey, username]) => {
      this.activeChannelMembers[serializeHash(pubKey)] = username;
    })
    console.warn(this.activeChannelMembers);
    // this.allMyChannels = [...this.allMyChannels, input.channel];
    this.service.setChannel(input.channel);
  }

  renderLandingPage() {
    return html`
      <p class="tagline">
        No Security<br>
        No Persistance<br>
        Just Signals
      </p>
      <div class="landing-form">
        <input class="landing-input" id="enter-name" type="text" placeholder="enter name"/>
        <input class="landing-input" id="join-channel" type="text" placeholder="join channel"/>
        <button id="start-bttn" @click=${this.start}>START</button>
      </div>
    `;
  }

  async switchChannel(ev: CustomEvent) {
    console.log("inside switchChannel");
    this.service.setChannel(ev.detail);
    const join_channel_input: ChannelMessageInput = {
      signalType: "JoinChannel",
      channel: ev.detail,
      username: this.username.value!,
    }

    this.joinChannel(join_channel_input);

    console.log("new channel value: ", this.activeChannel.value);
  }

  renderChatScreen() {
    return html`
      <chat-screen
        .channelMembers=${this.activeChannelMembers}
        @switchChannel=${this.switchChannel}
        .myAgentPubKey=${this.myAgentPubKey}
      ></chat-screen>
    `
  }

  render() {
    if (this.loading) {
      return html`
        <mwc-circular-progress indeterminate></mwc-circular-progress>
      `;
    }

    console.log("ACTIVE CHANNEL: ", this.activeChannel.value);

    // console.log("CHANNEL MEMBERS: ", this.channelMembers);

    // Landing Page
    // Chat Screen
    //    => bubbles
    //    => my own buuble

    return html`
      <main>
        <div class="main-title-container">
          <h1 class="main-title">BURNER CHAT</h1>
          <p class="powered-by-holochain">powered by holochain</p>
        </div>
        ${this.activeChannel.value
          ? this.renderChatScreen()
          : this.renderLandingPage()
        }
      </main>
    `
  }

  static styles = css`
    :host {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      font-size: calc(10px + 2vmin);
      color: #1a2b42;
      max-width: 960px;
      margin: 0 auto;
      text-align: center;
      background-color: var(--lit-element-background-color);
      font-size: 25px;
    }

    .main-title-container {
      position: relative;
      max-width: 700px;
      margin: 0 auto;
      margin-top: 20px;
      margin-bottom: 20px;
    }
    .powered-by-holochain {
      position: absolute;
      top: 50px;
      right: 0;
      font-family: 'Roboto Mono';
      font-size: 20px;
      color: #2E354C;
    }
    button#start-bttn {
      all: unset;
      margin: 10px;
      padding: 10px 20px;
      color: red;
      background-color: #2E354C;
      color: #FBFAF8;
      cursor: pointer;
      width: 300px;
      border-radius: 100px;
      font-weight: bold;
      font-family: 'Rubik';
    }

    .landing-form {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    main {
      flex-grow: 1;
    }

    .app-footer {
      font-size: calc(12px + 0.5vmin);
      align-items: center;
    }

    .app-footer a {
      margin-left: 5px;
    }

    button#start {
      all: unset;
      background: #2E354C;
      /* background: #2E354C; */
      padding: 10px 40px;
      border-radius: 100px;
      color: #FBFAF8;
      font-family: 'Rubik';
      font-size: 30px;
    }

    .tagline {
      font-family: Roboto Mono;
      font-size: 30px;
      margin-top: 80px;
      margin-bottom: 80px;
    }

    input.landing-input {
      all: unset;
      background-color: white;
      margin: 10px;
      padding: 10px 20px;
      box-shadow: 0 0 10px rgb(0 0 0 / 10%);
      border-radius: 100px;
      width: 300px;
    }
    input.landing-input::placeholder { /* Chrome, Firefox, Opera, Safari 10.1+ */
      color: #ADADAD;
    }

    .main-title {
      /* font-family: 'Rubik', monospace;
      font-weight: bold;
      color: #17E6B7; */
      font-size: 70px;
      font-family: RUBIK;
      font-weight: bold;
      color: #17E6B7;
      letter-spacing: 4px;
    }
  `;

  static get scopedElements() {
    return {
      "chat-screen": ChatScreen,
      "burner-service-context": BurnerServiceContext,
    }
  }
}


/**
LOADED FONTS, use like this
font-family: 'Roboto Mono', monospace;
font-family: 'Rubik', sans-serif;
 */