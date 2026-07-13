package com.gijo.as.domain;

public final class CtiFeedConfig {
    private final String id;
    private final String name;
    private volatile String apiKey;
    private volatile boolean connected;

    public CtiFeedConfig(String id, String name, String apiKey, boolean connected) {
        this.id = id;
        this.name = name;
        this.apiKey = apiKey;
        this.connected = connected;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getApiKey() { return apiKey; }
    public boolean isConnected() { return connected; }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
        this.connected = apiKey != null && !apiKey.isBlank();
    }
}
