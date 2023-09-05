import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";

async function run() {
  try {
    const target = context.payload.pull_request;
    if (target === undefined) {
      throw new Error("Can't get payload. Check you trigger event");
    }
    const { number } = target;

    const token = core.getInput("repo-token", { required: true });
    const status = core.getInput("status", { required: true });
    const octokit = getOctokit(token);

    const closing_issue_number_request = await octokit.graphql({
      query: `query {
        repository(owner: "${context.repo.owner}", name: "${context.repo.repo}") {
          pullRequest(number: ${number}) {
              id
              closingIssuesReferences (first: 50) {
                edges {
                  node {
                    id
                    body
                    number
                    title
                  }
                }
              }
          }
        }
      }`,
    });
    const closing_issue_numbers = closing_issue_number_request.repository.pullRequest.closingIssuesReferences.edges.map(
      (edge) => edge.node.number
    );
    for (const closing_issue_number of closing_issue_numbers) {
      // Finding projectItem id of particular project from issue
      const project_item_request = await octokit.graphql({
        query: `query {
          repository(owner: "${context.repo.owner}", name: "${context.repo.repo}") {
            issue(number: ${closing_issue_number}) {
              projectItems(first: 100) {
                nodes {
                  id
                  project {
                    id
                    title
                  }
                }
              }
            }
          }
        }`
      });
      const project_item_id = project_item_request.repository.issue.projectItems.nodes[0].id;
      const project_id = project_item_request.repository.issue.projectItems.nodes[0].project.id;

      // Finding project field id
      const project_field_request = await octokit.graphql({
        query: `query {
          node(id: "${project_id}") {
            ... on ProjectV2 {
              fields(first: 20) {
                nodes {
                  ... on ProjectV2Field {
                    id
                    name
                  }
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }`
      });
      const project_field_id = project_field_request.node.fields.nodes.find((node) => node.name === "Status").id;
      const single_select_option_id = project_field_request.node.fields.nodes.find((node) => node.name === "Status").options.find((option) => option.name === status).id;

      //Update project item field
      await octokit.graphql({
        query: `mutation {
          updateProjectV2ItemFieldValue(input: {projectId: "${project_id}, fieldId: "${project_field_id}, itemId: "${project_item_id}, value: {"singleSelectOptionId": "${single_select_option_id}}) {
            clientMutationId
          }
        }`
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
