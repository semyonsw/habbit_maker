package com.semyonsw.habitmaker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // FileSaverPlugin is a LOCAL plugin, and `cap sync` only wires up
        // plugins that come from npm packages -- so it has to be registered by
        // hand. Before super.onCreate(), because that is where the bridge is
        // built; a later call is too late and the plugin is simply absent at
        // runtime, with Export silently falling back to the share sheet.
        registerPlugin(FileSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
