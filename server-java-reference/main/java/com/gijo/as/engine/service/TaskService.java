package com.gijo.as.engine.service;

import com.gijo.as.domain.TaskItem;
import com.gijo.as.domain.TaskPriority;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/** 작업 큐 (서버 측, 전 클라이언트 공유). TODO(9.5절): SQLite/JPA 영속화. */
@Service
public class TaskService {

    private final List<TaskItem> tasks = new CopyOnWriteArrayList<>();
    private final AtomicLong sequence = new AtomicLong();

    public TaskItem createTask(String text, String agentId, TaskPriority priority) {
        String id = System.currentTimeMillis() + "-" + sequence.incrementAndGet();
        TaskItem item = new TaskItem(id, priority == null ? TaskPriority.P2 : priority, text, agentId, System.currentTimeMillis());
        tasks.add(item);
        return item;
    }

    public Optional<TaskItem> completeTask(String id) {
        Optional<TaskItem> found = tasks.stream().filter(t -> t.getId().equals(id)).findFirst();
        found.ifPresent(TaskItem::markDone);
        return found;
    }

    public List<TaskItem> listTasks() {
        return tasks;
    }
}
