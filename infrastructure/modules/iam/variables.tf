variable "name" { type = string }
variable "operational_table_arn" { type = string }
variable "operational_index_arn" { type = string }
variable "audit_table_arn" { type = string }
variable "log_group_arn" { type = string }
variable "tags" { type = map(string) }
