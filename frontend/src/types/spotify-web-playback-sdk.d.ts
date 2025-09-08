declare global {
  namespace Spotify {
    type ErrorTypes =
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error";

    interface PlayerInit {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void;
      volume?: number;
    }

    interface PlayerState {
      paused: boolean;
      position: number;
      duration: number;
      track_window?: { current_track?: { uri?: string } };
    }

    class Player {
      constructor(init: PlayerInit);
      connect(): Promise<boolean>;
      disconnect(): void;
      addListener(
        event: "ready" | "not_ready",
        cb: (data: { device_id: string }) => void
      ): boolean;
      addListener(event: "player_state_changed", cb: (s: PlayerState) => void): boolean;
      addListener(event: ErrorTypes, cb: (e: { message: string }) => void): boolean;
      removeListener(event: string): void;
      getCurrentState(): Promise<PlayerState | null>;
      togglePlay(): Promise<void>;
      pause(): Promise<void>;
      resume(): Promise<void>;
      previousTrack(): Promise<void>;
      nextTrack(): Promise<void>;
    }
  }

  interface Window {
    Spotify?: typeof Spotify;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
export {};
