package com.gijo.as.domain;

/**
 * Mutable on purpose: every connected client (CS 구조) observes the same shared
 * agent state, so status flips in place rather than being replaced.
 */
public final class AgentDefinition {
    private final String id;
    private final String name;
    private final String role;
    private final String brainModelId;
    private final AgentStatus defaultStatus;
    private volatile AgentStatus status;

    public AgentDefinition(String id, String name, String role, String brainModelId, AgentStatus defaultStatus) {
        this.id = id;
        this.name = name;
        this.role = role;
        this.brainModelId = brainModelId;
        this.defaultStatus = defaultStatus;
        this.status = defaultStatus;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getRole() { return role; }
    public String getBrainModelId() { return brainModelId; }
    public AgentStatus getDefaultStatus() { return defaultStatus; }
    public AgentStatus getStatus() { return status; }
    public void setStatus(AgentStatus status) { this.status = status; }
}
