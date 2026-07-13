package com.gijo.as.controller;

import com.gijo.as.domain.TaskItem;
import com.gijo.as.domain.TaskPriority;
import com.gijo.as.engine.service.TaskService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    public record CreateTaskRequest(String text) {
    }

    @GetMapping
    public List<TaskItem> listTasks() {
        return taskService.listTasks();
    }

    @PostMapping
    public TaskItem createTask(@RequestBody CreateTaskRequest request) {
        return taskService.createTask(request.text(), null, TaskPriority.P2);
    }

    @PostMapping("/{id}/complete")
    public List<TaskItem> completeTask(@PathVariable String id) {
        taskService.completeTask(id);
        return taskService.listTasks();
    }
}
