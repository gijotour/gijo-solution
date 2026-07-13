package com.gijo.as.domain;

public final class TaskItem {
    private final String id;
    private final TaskPriority priority;
    private final String text;
    private final String agentId;
    private final long createdAt;
    private volatile boolean done;

    public TaskItem(String id, TaskPriority priority, String text, String agentId, long createdAt) {
        this.id = id;
        this.priority = priority;
        this.text = text;
        this.agentId = agentId;
        this.createdAt = createdAt;
        this.done = false;
    }

    public String getId() { return id; }
    public TaskPriority getPriority() { return priority; }
    public String getText() { return text; }
    public String getAgentId() { return agentId; }
    public long getCreatedAt() { return createdAt; }
    public boolean isDone() { return done; }
    public void markDone() { this.done = true; }
}
